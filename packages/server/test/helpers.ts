import { ManualClock } from '../src/clock.js';
import { OpenRelay, type OpenRelayOptions } from '../src/relay.js';
import { DeliveryError, type OpenRelayPlugin } from '../src/plugins/types.js';
import type { EngineSettings, NotificationMessage, Route } from '../src/types.js';
import { MINUTE } from '../src/util/time.js';

export interface Sent {
  channel: string;
  message: NotificationMessage;
}

export interface TestRelay {
  relay: OpenRelay;
  clock: ManualClock;
  sent: Sent[];
  /** Makes the next `n` sends of the capture channel fail. */
  failNext(n: number, retryable?: boolean): void;
  channel(name: string): string;
  route(partial: Partial<Route> & { channels: string[] }): Route;
  /** Runs escalations, digests, maintenance and the delivery queue. */
  tick(): Promise<void>;
  advance(ms: number): Promise<void>;
}

export async function createTestRelay(
  opts: { settings?: Partial<EngineSettings>; options?: Partial<OpenRelayOptions> } = {},
): Promise<TestRelay> {
  const clock = new ManualClock(Date.UTC(2026, 3, 1, 10, 0, 0));
  const sent: Sent[] = [];
  let failures = 0;
  let failRetryable = true;
  const capture: OpenRelayPlugin = {
    name: 'test-capture',
    channels: [
      {
        type: 'capture',
        displayName: 'Capture',
        configSchema: [],
        async send(message, config) {
          if (failures > 0) {
            failures--;
            throw new DeliveryError('simulated outage', failRetryable);
          }
          sent.push({ channel: String(config.name), message });
        },
      },
    ],
  };
  const relay = await OpenRelay.create({
    databasePath: ':memory:',
    clock,
    plugins: [capture],
    publicUrl: 'https://relay.test',
    secret: 'test-secret',
    settings: { storm: { enabled: false, windowSeconds: 60, threshold: 30 }, ...opts.settings },
    ...opts.options,
  });
  let positions = 0;
  const t: TestRelay = {
    relay,
    clock,
    sent,
    failNext(n, retryable = true) {
      failures = n;
      failRetryable = retryable;
    },
    channel(name) {
      const id = `ch_${name}`;
      relay.store.upsertChannel({ id, name, type: 'capture', config: { name }, enabled: true }, clock.now());
      return id;
    },
    route(partial) {
      return relay.store.upsertRoute(
        {
          id: partial.id ?? `rt_${positions}`,
          name: partial.name ?? `route ${positions}`,
          position: partial.position ?? positions++,
          enabled: partial.enabled ?? true,
          matchers: partial.matchers ?? [],
          channels: partial.channels,
          delivery: partial.delivery ?? 'immediate',
          digestMinutes: partial.digestMinutes ?? null,
          escalationPolicyId: partial.escalationPolicyId ?? null,
          quietHours: partial.quietHours ?? null,
          notifyResolved: partial.notifyResolved ?? true,
          stop: partial.stop ?? false,
        },
        clock.now(),
      );
    },
    tick: () => relay.tick(),
    async advance(ms) {
      clock.advance(ms);
      await relay.tick();
    },
  };
  return t;
}

export { MINUTE };
