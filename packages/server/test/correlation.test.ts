import { describe, expect, it } from 'vitest';
import { inferRootCause, noisyOr, scoreCandidate, type CorrelationAlert } from '../src/engine/correlation.js';
import { DEFAULT_SETTINGS } from '../src/engine/settings.js';
import { Topology } from '../src/engine/topology.js';

const alert = (over: Partial<CorrelationAlert>): CorrelationAlert => ({
  fingerprint: Math.random().toString(36),
  source: 'prometheus',
  service: null,
  host: null,
  title: 'Something happened',
  labels: {},
  correlationKey: null,
  ...over,
});

const opts = (topology = new Topology()) => ({
  now: 1_000_000,
  settings: DEFAULT_SETTINGS.correlation,
  topology,
  learned: () => 0,
  locale: 'de' as const,
});

describe('correlation scoring', () => {
  it('noisy-or combines evidence', () => {
    expect(noisyOr([0.5, 0.5])).toBeCloseTo(0.75);
    expect(noisyOr([])).toBe(0);
  });

  it('groups by explicit correlation key', () => {
    const s = scoreCandidate(alert({ correlationKey: 'deploy-7' }), { incidentId: 'i', correlationKey: 'deploy-7', lastActivityAt: 0, alerts: [] }, opts());
    expect(s.score).toBe(1);
    expect(s.reasons[0]).toContain('deploy-7');
  });

  it('uses the dependency graph', () => {
    const topology = new Topology([{ service: 'api', dependsOn: 'postgres' }]);
    const s = scoreCandidate(
      alert({ service: 'api', title: 'HTTP 500 rate high' }),
      { incidentId: 'i', correlationKey: null, lastActivityAt: 1_000_000, alerts: [alert({ service: 'postgres', title: 'Postgres down' })] },
      opts(topology),
    );
    expect(s.score).toBeGreaterThanOrEqual(DEFAULT_SETTINGS.correlation.threshold);
    expect(s.reasons.join()).toContain('api hängt von postgres ab');
  });

  it('keeps unrelated alerts apart', () => {
    const s = scoreCandidate(
      alert({ service: 'mail', host: 'mx1', title: 'Queue too long', source: 'zabbix' }),
      { incidentId: 'i', correlationKey: null, lastActivityAt: 1_000_000, alerts: [alert({ service: 'shop', host: 'web1', title: 'Checkout slow' })] },
      opts(),
    );
    expect(s.score).toBeLessThan(DEFAULT_SETTINGS.correlation.relatedThreshold);
  });

  it('respects learned separations', () => {
    const a = alert({ service: 'api', fingerprint: 'a' });
    const b = alert({ service: 'api', fingerprint: 'b' });
    const s = scoreCandidate(a, { incidentId: 'i', correlationKey: null, lastActivityAt: 1_000_000, alerts: [b] }, { ...opts(), learned: () => -1 });
    expect(s.blocked).toBe(true);
    expect(s.score).toBe(0);
  });

  it('decays evidence over the correlation window', () => {
    const windowMs = DEFAULT_SETTINGS.correlation.windowMinutes * 60_000;
    const make = (lastActivityAt: number) =>
      scoreCandidate(alert({ service: 'api' }), { incidentId: 'i', correlationKey: null, lastActivityAt, alerts: [alert({ service: 'api' })] }, opts()).score;
    expect(make(1_000_000)).toBeGreaterThan(make(1_000_000 - windowMs));
  });
});

describe('root cause inference', () => {
  it('prefers the service others depend on', () => {
    const topology = new Topology([
      { service: 'api', dependsOn: 'postgres' },
      { service: 'worker', dependsOn: 'postgres' },
    ]);
    const root = inferRootCause(
      [
        { id: 'a1', service: 'api', firstSeen: 1, status: 'firing', severity: 'high' },
        { id: 'a2', service: 'worker', firstSeen: 2, status: 'firing', severity: 'high' },
        { id: 'a3', service: 'postgres', firstSeen: 3, status: 'firing', severity: 'critical' },
      ],
      topology,
      'de',
    );
    expect(root?.alertId).toBe('a3');
    expect(root?.reason).toContain('postgres ist Abhängigkeit von api, worker');
  });

  it('falls back to the earliest signal', () => {
    const root = inferRootCause(
      [
        { id: 'late', service: 'b', firstSeen: 5, status: 'firing', severity: 'high' },
        { id: 'early', service: 'a', firstSeen: 1, status: 'firing', severity: 'info' },
      ],
      new Topology(),
      'de',
    );
    expect(root?.alertId).toBe('early');
  });
});
