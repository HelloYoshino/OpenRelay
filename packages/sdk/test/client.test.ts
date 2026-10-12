import { createServer, type IncomingMessage, type Server } from 'node:http';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { OpenRelayClient, OpenRelayError } from '../src/index.js';

interface Fake {
  url: string;
  received: unknown[];
  mode: 'ok' | 'down' | 'reject';
  close(): Promise<void>;
}

async function fakeServer(): Promise<Fake> {
  const received: unknown[] = [];
  const fake = { mode: 'ok' } as Fake;
  const server: Server = createServer(async (req: IncomingMessage, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    if (fake.mode === 'down') {
      res.writeHead(503).end();
      return;
    }
    if (fake.mode === 'reject') {
      res.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'title fehlt' }));
      return;
    }
    const body = JSON.parse(Buffer.concat(chunks).toString()) as unknown[];
    received.push(...body);
    res.writeHead(202, { 'content-type': 'application/json' }).end(
      JSON.stringify({ accepted: body.length, results: body.map(() => ({ eventId: 'e', alertId: 'a', incidentId: 'i', action: 'created' })) }),
    );
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as { port: number };
  return Object.assign(fake, {
    url: `http://127.0.0.1:${port}`,
    received,
    close: () => new Promise<void>((r) => server.close(() => r())),
  });
}

let fake: Fake;
afterEach(async () => fake?.close());

describe('OpenRelayClient', () => {
  it('sends events with default source and auth', async () => {
    fake = await fakeServer();
    const client = new OpenRelayClient({ url: fake.url, token: 't', source: 'delta-ai' });
    const res = await client.critical('DB down', { service: 'api' });
    expect(res.status).toBe('sent');
    expect(fake.received[0]).toMatchObject({ title: 'DB down', severity: 'critical', source: 'delta-ai', service: 'api' });
  });

  it('queues while the server is down and delivers in order later', async () => {
    fake = await fakeServer();
    fake.mode = 'down';
    const client = new OpenRelayClient({ url: fake.url, token: 't', queue: { retryBaseMs: 20, retryMaxMs: 50 } });
    expect((await client.warning('first')).status).toBe('queued');
    expect((await client.warning('second')).status).toBe('queued');
    expect(client.pending).toBe(2);
    fake.mode = 'ok';
    await new Promise((r) => setTimeout(r, 200));
    expect(client.pending).toBe(0);
    expect(fake.received.map((e) => (e as { title: string }).title)).toEqual(['first', 'second']);
    await client.close();
  });

  it('persists the queue to disk', async () => {
    fake = await fakeServer();
    fake.mode = 'down';
    const file = join(mkdtempSync(join(tmpdir(), 'or-sdk-')), 'queue.json');
    const a = new OpenRelayClient({ url: fake.url, token: 't', queue: { persistPath: file, retryBaseMs: 10_000 } });
    await a.high('survives restart');
    expect(JSON.parse(readFileSync(file, 'utf8'))).toHaveLength(1);
    await a.close(10);

    fake.mode = 'ok';
    const b = new OpenRelayClient({ url: fake.url, token: 't', queue: { persistPath: file } });
    expect(await b.flush()).toBe(0);
    expect(fake.received).toHaveLength(1);
  });

  it('does not queue rejected events', async () => {
    fake = await fakeServer();
    fake.mode = 'reject';
    const client = new OpenRelayClient({ url: fake.url, token: 't' });
    await expect(client.send({ title: '' })).rejects.toBeInstanceOf(OpenRelayError);
    expect(client.pending).toBe(0);
  });

  it('drops the oldest events when the queue is full', async () => {
    fake = await fakeServer();
    fake.mode = 'down';
    const client = new OpenRelayClient({ url: fake.url, token: 't', queue: { maxSize: 2, retryBaseMs: 10_000 } });
    await client.info('1');
    await client.info('2');
    await client.info('3');
    expect(client.pending).toBe(2);
    expect(client.dropped).toBe(1);
    await client.close(10);
  });
});
