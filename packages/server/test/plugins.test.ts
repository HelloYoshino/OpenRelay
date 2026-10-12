import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createTestRelay } from './helpers.js';

const examples = fileURLToPath(new URL('../../../examples/plugins', import.meta.url));

describe('plugin loading', () => {
  it('loads channels, adapters and processors from a directory', async () => {
    const t = await createTestRelay({ options: { pluginDir: examples } });
    expect(t.relay.registry.channel('teams')?.displayName).toBe('Microsoft Teams');
    expect(t.relay.registry.adapter('healthchecks')).toBeDefined();
    expect(t.relay.registry.plugins.find((p) => p.name === 'example-plugin')?.version).toBe('1.0.0');

    const [res] = await t.relay.ingest({ title: 'Replication lag', host: 'prod-db-1' });
    expect(t.relay.store.getAlert(res.alertId!)!.labels.env).toBe('prod');

    const events = await t.relay.registry
      .adapter('healthchecks')!
      .parse({ body: { name: 'nightly-backup', status: 'down', code: 'abc' }, rawBody: null, headers: {}, query: {} }, { logger: t.relay.logger, env: () => undefined });
    expect(events[0]).toMatchObject({ status: 'firing', fingerprint: 'healthchecks:abc' });
    await t.relay.close();
  });

  it('keeps running when a plugin is broken', async () => {
    const t = await createTestRelay({ options: { pluginDir: '/nonexistent/dir' } });
    expect(t.relay.registry.channel('discord')).toBeDefined();
    await t.relay.close();
  });
});
