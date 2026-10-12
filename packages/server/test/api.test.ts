import { createHmac } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Authenticator } from '../src/api/auth.js';
import { buildApp } from '../src/api/server.js';
import { createTestRelay, type TestRelay } from './helpers.js';

const ADMIN = 'admin-token-for-tests';

let t: TestRelay;
let app: FastifyInstance;
let auth: Authenticator;

const headers = { authorization: `Bearer ${ADMIN}` };

beforeEach(async () => {
  t = await createTestRelay();
  auth = new Authenticator(t.relay, ADMIN);
  app = await buildApp({ relay: t.relay, auth, webDir: null, env: { OPENRELAY_GITHUB_SECRET: 'gh-secret' } });
});

afterEach(async () => {
  await app.close();
  await t.relay.close();
});

describe('auth', () => {
  it('rejects missing and invalid tokens', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/v1/incidents' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/api/v1/incidents', headers: { authorization: 'Bearer nope' } })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/healthz' })).json().status).toBe('ok');
  });

  it('enforces API key scopes', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/api-keys', headers, payload: { name: 'ci', scopes: ['ingest'], defaultSource: 'ci' } });
    expect(res.statusCode).toBe(201);
    const { token } = res.json();
    const ingest = await app.inject({ method: 'POST', url: `/api/v1/events?token=${token}`, payload: { title: 'Build broken' } });
    expect(ingest.statusCode).toBe(202);
    expect(t.relay.store.listEvents({})[0].source).toBe('ci');
    const read = await app.inject({ method: 'GET', url: '/api/v1/incidents', headers: { 'x-openrelay-token': token } });
    expect(read.statusCode).toBe(403);
    const me = await app.inject({ method: 'GET', url: '/api/v1/me', headers: { 'x-openrelay-token': token } });
    expect(me.json()).toMatchObject({ name: 'ci', scopes: ['ingest'] });
  });
});

describe('ingestion', () => {
  it('accepts single events, batches and reports actions', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/events',
      headers,
      payload: [
        { title: 'Queue full', service: 'worker', severity: 'error' },
        { title: 'Queue full', service: 'worker', severity: 'error' },
      ],
    });
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.accepted).toBe(2);
    expect(body.results.map((r: { action: string }) => r.action)).toEqual(['created', 'deduplicated']);
    expect(t.relay.store.getAlert(body.results[0].alertId)!.severity).toBe('high');
  });

  it('validates input', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/events', headers, payload: { message: 'no title' } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('title');
  });

  it('ingests plain text like curl -d', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/ingest/text?token=${ADMIN}&severity=high&source=backup`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'Backup fehlgeschlagen\nrsync exit code 23',
    });
    expect(res.statusCode).toBe(202);
    const [event] = t.relay.store.listEvents({});
    expect(event).toMatchObject({ title: 'Backup fehlgeschlagen', message: 'rsync exit code 23', severity: 'high', source: 'backup' });
  });

  it('understands Alertmanager webhooks including resolves', async () => {
    const payload = (status: string) => ({
      version: '4',
      status,
      commonLabels: { cluster: 'prod' },
      alerts: [
        {
          status,
          fingerprint: 'abc123',
          labels: { alertname: 'HighLatency', severity: 'critical', job: 'api', instance: 'api-1:9090' },
          annotations: { summary: 'p99 latency above 2s' },
          startsAt: '2026-04-01T09:59:00Z',
        },
      ],
    });
    const first = await app.inject({ method: 'POST', url: '/api/v1/ingest/alertmanager', headers, payload: payload('firing') });
    expect(first.statusCode).toBe(202);
    const incidentId = first.json().results[0].incidentId;
    const incident = t.relay.store.getIncident(incidentId)!;
    expect(incident).toMatchObject({ title: 'p99 latency above 2s', severity: 'critical', services: ['api'] });

    await app.inject({ method: 'POST', url: '/api/v1/ingest/alertmanager', headers, payload: payload('resolved') });
    expect(t.relay.store.getIncident(incidentId)!.status).toBe('resolved');
  });

  it('verifies GitHub signatures and maps workflow runs', async () => {
    const body = JSON.stringify({
      action: 'completed',
      workflow_run: {
        name: 'CI',
        workflow_id: 7,
        head_branch: 'main',
        head_sha: 'abcdef1234567',
        conclusion: 'failure',
        html_url: 'https://github.com/acme/shop/actions/runs/1',
        actor: { login: 'octocat' },
        event: 'push',
      },
      repository: { name: 'shop', full_name: 'acme/shop', default_branch: 'main' },
    });
    const sign = (secret: string) => `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
    const bad = await app.inject({
      method: 'POST',
      url: `/api/v1/ingest/github?token=${ADMIN}`,
      headers: { 'content-type': 'application/json', 'x-github-event': 'workflow_run', 'x-hub-signature-256': sign('wrong') },
      payload: body,
    });
    expect(bad.statusCode).toBe(400);
    const ok = await app.inject({
      method: 'POST',
      url: `/api/v1/ingest/github?token=${ADMIN}`,
      headers: { 'content-type': 'application/json', 'x-github-event': 'workflow_run', 'x-hub-signature-256': sign('gh-secret') },
      payload: body,
    });
    expect(ok.statusCode).toBe(202);
    const alert = t.relay.store.getAlert(ok.json().results[0].alertId)!;
    expect(alert).toMatchObject({ source: 'github', severity: 'high', service: 'shop', fingerprint: 'github:workflow:acme/shop:7:main' });
  });

  it('rejects unknown adapters', async () => {
    expect((await app.inject({ method: 'POST', url: '/api/v1/ingest/nope', headers, payload: {} })).statusCode).toBe(404);
  });
});

describe('incidents', () => {
  it('lists, shows and acts on incidents', async () => {
    const [res] = await t.relay.ingest({ title: 'Mail queue stuck', service: 'mail', severity: 'high' });
    const list = await app.inject({ method: 'GET', url: '/api/v1/incidents?status=open,acknowledged', headers });
    expect(list.json().total).toBe(1);

    const detail = await app.inject({ method: 'GET', url: `/api/v1/incidents/${res.incidentId}`, headers });
    expect(detail.json().alerts).toHaveLength(1);
    expect(detail.json().timeline[0].kind).toBe('created');
    expect((await app.inject({ method: 'GET', url: '/api/v1/incidents/1', headers })).json().incident.id).toBe(res.incidentId);

    const ack = await app.inject({ method: 'POST', url: `/api/v1/incidents/${res.incidentId}/ack`, headers, payload: { actor: 'alice' } });
    expect(ack.json().incident).toMatchObject({ status: 'acknowledged', acknowledgedBy: 'alice' });
    await app.inject({ method: 'POST', url: `/api/v1/incidents/${res.incidentId}/comment`, headers, payload: { text: 'Restarting postfix' } });
    const resolved = await app.inject({ method: 'POST', url: `/api/v1/incidents/${res.incidentId}/resolve`, headers, payload: { note: 'fixed' } });
    expect(resolved.json().incident.status).toBe('resolved');
    const reopened = await app.inject({ method: 'POST', url: `/api/v1/incidents/${res.incidentId}/reopen`, headers, payload: {} });
    expect(reopened.json().incident.status).toBe('open');
  });

  it('merges incidents and detaches alerts', async () => {
    const [a] = await t.relay.ingest({ title: 'A broke', service: 'a', source: 's1' });
    const [b] = await t.relay.ingest({ title: 'B broke', service: 'b', source: 's2' });
    const merge = await app.inject({ method: 'POST', url: `/api/v1/incidents/${b.incidentId}/merge`, headers, payload: { targetId: a.incidentId } });
    expect(merge.statusCode).toBe(200);
    expect(merge.json().incident.alertCount).toBe(2);
    const detach = await app.inject({ method: 'POST', url: `/api/v1/alerts/${b.alertId}/detach`, headers, payload: {} });
    expect(detach.statusCode).toBe(200);
    expect(detach.json().incident.id).not.toBe(a.incidentId);
  });

  it('acknowledges through signed links (GET confirms, POST acts)', async () => {
    const [res] = await t.relay.ingest({ title: 'Disk failing', severity: 'critical' });
    const sig = t.relay.sign(res.incidentId!, 'ack');
    expect((await app.inject({ method: 'POST', url: `/a/${res.incidentId}/ack?sig=wrong` })).statusCode).toBe(403);
    const get = await app.inject({ method: 'GET', url: `/a/${res.incidentId}/ack?sig=${sig}` });
    expect(get.body).toContain('<form method="post">');
    expect(t.relay.store.getIncident(res.incidentId!)!.status).toBe('open');
    const post = await app.inject({ method: 'POST', url: `/a/${res.incidentId}/ack?sig=${sig}` });
    expect(post.statusCode).toBe(200);
    expect(t.relay.store.getIncident(res.incidentId!)!.acknowledgedBy).toBe('link');
  });
});

describe('configuration', () => {
  it('manages channels with masked secrets', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/channels',
      headers,
      payload: { name: 'Ops ntfy', type: 'ntfy', config: { topic: 'ops-alerts', token: 'tk_secret' } },
    });
    expect(create.statusCode).toBe(201);
    const channel = create.json().channel;
    expect(channel.config.token).toBe('••••••');
    expect(channel.config.server).toBe('https://ntfy.sh');

    const update = await app.inject({ method: 'PUT', url: `/api/v1/channels/${channel.id}`, headers, payload: { ...channel, name: 'Ops' } });
    expect(update.statusCode).toBe(200);
    expect(t.relay.store.getChannel(channel.id)!.config.token).toBe('tk_secret');

    const toggle = await app.inject({ method: 'PUT', url: `/api/v1/channels/${channel.id}`, headers, payload: { enabled: false } });
    expect(toggle.json().channel.enabled).toBe(false);
    expect(t.relay.store.getChannel(channel.id)!.config.token).toBe('tk_secret');

    const invalid = await app.inject({ method: 'POST', url: '/api/v1/channels', headers, payload: { name: 'x', type: 'ntfy', config: { topic: 'bad topic!' } } });
    expect(invalid.statusCode).toBe(400);
  });

  it('validates routes and simulates routing', async () => {
    const ch = t.channel('ops');
    const bad = await app.inject({ method: 'POST', url: '/api/v1/routes', headers, payload: { name: 'x', matchers: ['severity ~ x'], channels: [ch] } });
    expect(bad.statusCode).toBe(400);
    const missing = await app.inject({ method: 'POST', url: '/api/v1/routes', headers, payload: { name: 'x', channels: ['nope'] } });
    expect(missing.statusCode).toBe(400);

    const ok = await app.inject({
      method: 'POST',
      url: '/api/v1/routes',
      headers,
      payload: { name: 'Prod critical', matchers: ['severity >= high', 'labels.env = prod'], channels: [ch], delivery: 'auto' },
    });
    expect(ok.statusCode).toBe(201);
    const sim = await app.inject({
      method: 'POST',
      url: '/api/v1/routes/simulate',
      headers,
      payload: { event: { title: 'x', severity: 'critical', labels: { env: 'prod' } } },
    });
    expect(sim.json().routes[0]).toMatchObject({ matched: true, mode: 'immediate' });
    const miss = await app.inject({ method: 'POST', url: '/api/v1/routes/simulate', headers, payload: { event: { title: 'x', severity: 'info' } } });
    expect(miss.json().routes[0].matched).toBe(false);
  });

  it('creates escalation policies, silences, topology and settings', async () => {
    const ch = t.channel('ops');
    const policy = await app.inject({
      method: 'POST',
      url: '/api/v1/escalation-policies',
      headers,
      payload: { name: 'Oncall', steps: [{ delayMinutes: 5, channels: [ch] }], repeat: 2 },
    });
    expect(policy.statusCode).toBe(201);
    const silence = await app.inject({ method: 'POST', url: '/api/v1/silences', headers, payload: { matchers: ['service = nas'], durationMinutes: 60, comment: 'Umzug' } });
    expect(silence.statusCode).toBe(201);
    expect((await app.inject({ method: 'GET', url: '/api/v1/silences?active=true', headers })).json().items).toHaveLength(1);

    const topo = await app.inject({ method: 'PUT', url: '/api/v1/topology', headers, payload: { items: [{ service: 'api', dependsOn: 'db' }] } });
    expect(topo.json().items).toHaveLength(1);
    expect(t.relay.topology().distance('api', 'db')).toBe(1);

    const settings = await app.inject({ method: 'PUT', url: '/api/v1/settings', headers, payload: { settings: { correlation: { windowMinutes: 30 } } } });
    expect(settings.json().settings.correlation.windowMinutes).toBe(30);
    expect(settings.json().settings.correlation.threshold).toBe(0.6);
    const invalid = await app.inject({ method: 'PUT', url: '/api/v1/settings', headers, payload: { settings: { correlation: { threshold: 3 } } } });
    expect(invalid.statusCode).toBe(400);
  });

  it('round-trips configuration as YAML', async () => {
    const yaml = `
channels:
  - id: ops-chat
    name: Ops Chat
    type: webhook
    config:
      url: \${HOOK_URL:-https://example.com/hook}
escalationPolicies:
  - id: oncall
    name: Bereitschaft
    steps:
      - delayMinutes: 10
        channels: [ops-chat]
routes:
  - name: Alles Kritische
    matchers: ["severity >= high"]
    channels: [ops-chat]
    escalationPolicy: oncall
topology:
  - service: api
    dependsOn: [postgres, redis]
settings:
  locale: en
`;
    const res = await app.inject({ method: 'POST', url: '/api/v1/config/import', headers: { ...headers, 'content-type': 'text/yaml' }, payload: yaml });
    expect(res.statusCode).toBe(200);
    expect(res.json().imported).toMatchObject({ channels: 1, escalationPolicies: 1, routes: 1, dependencies: 2, settings: true });
    expect(t.relay.store.getRoute('alles-kritische')!.escalationPolicyId).toBe('oncall');
    expect(t.relay.settings().locale).toBe('en');

    const exported = await app.inject({ method: 'GET', url: '/api/v1/config/export', headers });
    expect(exported.body).toContain('ops-chat');
    expect(exported.body).toContain('escalationPolicy: oncall');
  });
});

describe('stats & stream', () => {
  it('reports noise reduction', async () => {
    const ch = t.channel('ops');
    t.route({ channels: [ch] });
    t.clock.advance(123_457); // not aligned to a bucket boundary
    for (let i = 0; i < 50; i++) {
      await t.relay.ingest({ title: 'Same error', severity: 'high' });
      t.clock.advance(1_013);
    }
    await t.tick();
    const stats = (await app.inject({ method: 'GET', url: '/api/v1/stats?hours=1', headers })).json();
    expect(stats.totals).toMatchObject({ events: 50, alerts: 1, incidents: 1, notifications: 1 });
    expect(stats.noiseReduction).toBeCloseTo(0.98);
    expect(stats.eventsSeries.reduce((sum: number, p: { count: number }) => sum + p.count, 0)).toBe(50);
    expect(stats.notificationsSeries.reduce((sum: number, p: { count: number }) => sum + p.count, 0)).toBe(1);
  });

  it('exposes Prometheus metrics', async () => {
    await t.relay.ingest({ title: 'x', severity: 'critical' });
    const res = await app.inject({ method: 'GET', url: '/metrics', headers });
    expect(res.body).toContain('openrelay_incidents_open{severity="critical"} 1');
  });
});
