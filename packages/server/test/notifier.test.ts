import { describe, expect, it } from 'vitest';
import { quietHoursState } from '../src/engine/notifier.js';
import { Topology } from '../src/engine/topology.js';
import { backoff } from '../src/engine/delivery.js';

const at = (h: number, m = 0) => Date.UTC(2026, 3, 1, h, m);

describe('quiet hours', () => {
  it('handles windows across midnight', () => {
    const q = { start: '22:00', end: '07:00', timezone: 'UTC' };
    expect(quietHoursState(q, at(23)).active).toBe(true);
    expect(quietHoursState(q, at(3)).active).toBe(true);
    expect(quietHoursState(q, at(7)).active).toBe(false);
    expect(quietHoursState(q, at(12)).active).toBe(false);
    expect(quietHoursState(q, at(23)).endsAt).toBe(Date.UTC(2026, 3, 2, 7, 0));
    expect(quietHoursState(q, at(3, 30)).endsAt).toBe(at(7));
  });

  it('respects time zones', () => {
    // 21:30 UTC = 23:30 in Berlin (CEST)
    expect(quietHoursState({ start: '23:00', end: '06:00', timezone: 'Europe/Berlin' }, at(21, 30)).active).toBe(true);
    expect(quietHoursState({ start: '23:00', end: '06:00', timezone: 'UTC' }, at(21, 30)).active).toBe(false);
  });
});

describe('topology', () => {
  const t = new Topology([
    { service: 'web', dependsOn: 'api' },
    { service: 'api', dependsOn: 'postgres' },
    { service: 'worker', dependsOn: 'postgres' },
    { service: 'postgres', dependsOn: 'storage' },
  ]);

  it('computes transitive distances and relations', () => {
    expect(t.distance('web', 'postgres')).toBe(2);
    expect(t.distance('postgres', 'web')).toBeNull();
    expect(t.relation('postgres', 'web')).toEqual({ upstream: 'postgres', downstream: 'web', distance: 2 });
  });

  it('finds the closest shared dependency', () => {
    expect(t.commonDependency('api', 'worker')).toBe('postgres');
    expect(t.commonDependency('web', 'storage')).toBeNull();
  });

  it('is safe with cycles', () => {
    const cyclic = new Topology([
      { service: 'a', dependsOn: 'b' },
      { service: 'b', dependsOn: 'a' },
    ]);
    expect(cyclic.distance('a', 'b')).toBe(1);
    expect(cyclic.distance('a', 'c')).toBeNull();
  });
});

describe('backoff', () => {
  it('grows exponentially and is capped', () => {
    const mid = () => 0.5;
    expect(backoff(1, mid)).toBe(5000);
    expect(backoff(2, mid)).toBe(10_000);
    expect(backoff(20, mid)).toBe(30 * 60_000);
  });
});
