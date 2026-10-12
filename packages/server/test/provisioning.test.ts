import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ConfigService } from '../src/config-service.js';
import { exportConfig, importConfig, interpolate, parseConfigText } from '../src/provisioning.js';
import { createTestRelay } from './helpers.js';

const example = fileURLToPath(new URL('../../../examples/openrelay.yaml', import.meta.url));
const env = {
  DISCORD_WEBHOOK_URL: 'https://discord.com/api/webhooks/123/abc',
  TELEGRAM_BOT_TOKEN: '123456:ABC-def',
  TELEGRAM_CHAT_ID: '-100123',
};

describe('provisioning', () => {
  it('imports the example configuration', async () => {
    const t = await createTestRelay();
    const service = new ConfigService(t.relay);
    const summary = importConfig(t.relay, service, parseConfigText(readFileSync(example, 'utf8')), env);
    expect(summary).toMatchObject({ channels: 4, escalationPolicies: 1, routes: 3, dependencies: 5, settings: true });
    expect(t.relay.store.listRoutes().map((r) => r.id)).toEqual(['wartungsfenster', 'kritisch', 'rest']);
    expect(t.relay.store.getRoute('kritisch')!.quietHours?.timezone).toBe('Europe/Berlin');
    expect(t.relay.topology().distance('delta-ai', 'postgres')).toBe(2);
    expect(t.relay.settings().notifications.digestMinutes).toBe(30);

    // Importing twice is idempotent.
    importConfig(t.relay, service, parseConfigText(readFileSync(example, 'utf8')), env);
    expect(t.relay.store.listChannels()).toHaveLength(4);

    // Export → import keeps masked secrets.
    const yaml = exportConfig(t.relay, service);
    expect(yaml).not.toContain('123456:ABC-def');
    importConfig(t.relay, service, parseConfigText(yaml), {});
    expect(t.relay.store.getChannel('telegram-oncall')!.config.botToken).toBe('123456:ABC-def');
    await t.relay.close();
  });

  it('reports missing environment variables', () => {
    expect(() => interpolate({ a: '${MISSING_VAR}' }, {})).toThrow(/MISSING_VAR/);
    expect(interpolate({ a: '${MISSING_VAR:-fallback}' }, {})).toEqual({ a: 'fallback' });
  });
});
