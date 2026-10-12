import { describe, expect, it } from 'vitest';
import { createTestRelay, MINUTE } from './helpers.js';

describe('deduplication', () => {
  it('folds 200 identical errors into one alert, one incident and one notification', async () => {
    const t = await createTestRelay();
    const ch = t.channel('ops');
    t.route({ channels: [ch] });

    for (let i = 0; i < 200; i++) {
      await t.relay.ingest({ title: `Timeout after ${100 + i} ms for request ${i}`, source: 'shop', service: 'checkout', severity: 'high' });
      t.clock.advance(100);
    }
    await t.tick();

    const { items: incidents } = t.relay.store.listIncidents({});
    expect(incidents).toHaveLength(1);
    expect(incidents[0].alertCount).toBe(1);
    expect(incidents[0].eventCount).toBe(200);
    expect(t.sent).toHaveLength(1);
    expect(t.sent[0].message.kind).toBe('incident.opened');
    expect(t.sent[0].message.text).toContain('1 Alarm · 1 Ereignis');
  });

  it('resolves the incident when the resolve event arrives and notifies once', async () => {
    const t = await createTestRelay();
    const ch = t.channel('ops');
    t.route({ channels: [ch] });

    await t.relay.ingest({ title: 'API down', service: 'api', severity: 'critical', fingerprint: 'api-down' });
    await t.tick();
    t.clock.advance(5 * MINUTE);
    const [res] = await t.relay.ingest({ title: 'API down', service: 'api', status: 'resolved', fingerprint: 'api-down' });
    await t.tick();

    expect(res.action).toBe('resolved');
    const incident = t.relay.store.getIncident(res.incidentId!)!;
    expect(incident.status).toBe('resolved');
    expect(incident.resolvedBy).toBe('auto');
    expect(t.sent.map((s) => s.message.kind)).toEqual(['incident.opened', 'incident.resolved']);
    expect(t.sent[1].message.text).toContain('Dauer: 5 min');
  });

  it('reopens a recently resolved incident instead of creating a new one', async () => {
    const t = await createTestRelay();
    const ch = t.channel('ops');
    t.route({ channels: [ch] });
    const fp = { fingerprint: 'disk', title: 'Disk full', severity: 'high' as const };

    const [first] = await t.relay.ingest(fp);
    await t.relay.ingest({ ...fp, status: 'resolved' });
    t.clock.advance(10 * MINUTE);
    const [again] = await t.relay.ingest(fp);
    await t.tick();

    expect(again.action).toBe('reopened');
    expect(again.incidentId).toBe(first.incidentId);
    expect(t.relay.store.getIncident(first.incidentId!)!.status).toBe('open');
    expect(t.sent.map((s) => s.message.kind)).toEqual(['incident.opened', 'incident.resolved', 'incident.reopened']);
  });

  it('opens a new incident after the reopen window and links the recurrence', async () => {
    const t = await createTestRelay();
    const fp = { fingerprint: 'cert', title: 'Certificate expired', severity: 'high' as const };
    const [first] = await t.relay.ingest(fp);
    await t.relay.ingest({ ...fp, status: 'resolved' });
    t.clock.advance(3 * 60 * MINUTE);
    const [second] = await t.relay.ingest(fp);

    expect(second.action).toBe('created');
    expect(second.incidentId).not.toBe(first.incidentId);
    const incident = t.relay.store.getIncident(second.incidentId!)!;
    expect(incident.recurrenceCount).toBe(1);
    const links = t.relay.store.linksFor(incident.id);
    expect(links.find((l) => l.kind === 'recurrence')?.relatedId).toBe(first.incidentId);
  });

  it('ignores resolve events for unknown alerts', async () => {
    const t = await createTestRelay();
    const [res] = await t.relay.ingest({ title: 'Never fired', status: 'resolved' });
    expect(res.action).toBe('ignored');
    expect(t.relay.store.listIncidents({}).total).toBe(0);
  });
});

describe('correlation', () => {
  it('groups alerts of dependent services and finds the root cause', async () => {
    const t = await createTestRelay();
    t.relay.setDependencies([
      { service: 'api', dependsOn: 'postgres' },
      { service: 'worker', dependsOn: 'postgres' },
    ]);
    const [a] = await t.relay.ingest({ title: 'HTTP 500 rate above 5%', service: 'api', source: 'prometheus', severity: 'high' });
    t.clock.advance(20_000);
    const [b] = await t.relay.ingest({ title: 'Job queue stalled', service: 'worker', source: 'prometheus', severity: 'warning' });
    t.clock.advance(20_000);
    const [c] = await t.relay.ingest({ title: 'Postgres not reachable', service: 'postgres', source: 'uptime-kuma', severity: 'critical' });

    // api and worker are siblings → two incidents (linked as related) until postgres explains both.
    expect(b.incidentId).not.toBe(a.incidentId);
    expect(t.relay.store.linksFor(b.incidentId!).some((l) => l.kind === 'related')).toBe(true);
    const current = [a, b, c].map((r) => t.relay.store.getAlert(r.alertId!)!.incidentId);
    expect(new Set(current).size).toBe(1);
    const incident = t.relay.store.getIncident(current[0]!)!;
    expect(incident.alertCount).toBe(3);
    const merged = t.relay.store.getIncident(current[0] === a.incidentId ? b.incidentId! : a.incidentId!)!;
    expect(merged.status).toBe('resolved');
    expect(merged.resolvedBy).toMatch(/^merge:/);
    expect(incident.severity).toBe('critical');
    expect(incident.title).toBe('Postgres not reachable');
    expect(incident.rootReason).toContain('postgres ist Abhängigkeit von api, worker');

    const timeline = t.relay.store.timeline(incident.id);
    const added = timeline.filter((e) => e.kind === 'alert_added');
    expect(added).toHaveLength(1);
    expect((added[0].data?.reasons as string[]).join()).toContain('hängt von postgres ab');
    expect(timeline.find((e) => e.kind === 'merged')?.message).toContain('gemeinsame Ursache: postgres');
  });

  it('keeps unrelated alerts in separate incidents', async () => {
    const t = await createTestRelay();
    const [a] = await t.relay.ingest({ title: 'Backup failed', source: 'cron', service: 'backup', host: 'nas' });
    const [b] = await t.relay.ingest({ title: 'Certificate expires in 5 days', source: 'certbot', service: 'web', host: 'proxy' });
    expect(a.incidentId).not.toBe(b.incidentId);
  });

  it('always groups by correlation key', async () => {
    const t = await createTestRelay();
    const [a] = await t.relay.ingest({ title: 'Migration failed', source: 'deploy', correlationKey: 'release-42' });
    t.clock.advance(2 * 60 * MINUTE);
    const [b] = await t.relay.ingest({ title: 'Smoke test failed', source: 'ci', correlationKey: 'release-42' });
    expect(b.incidentId).toBe(a.incidentId);
  });

  it('does not correlate beyond the window', async () => {
    const t = await createTestRelay();
    const [a] = await t.relay.ingest({ title: 'Slow responses', service: 'api' });
    t.clock.advance(30 * MINUTE);
    const [b] = await t.relay.ingest({ title: 'Memory high', service: 'api' });
    expect(b.incidentId).not.toBe(a.incidentId);
  });

  it('links possibly related incidents', async () => {
    const t = await createTestRelay();
    const [a] = await t.relay.ingest({ title: 'Disk usage high', host: 'srv-1', service: 'files' });
    const [b] = await t.relay.ingest({ title: 'Load average high', host: 'srv-1', service: 'cpu' });
    expect(b.incidentId).not.toBe(a.incidentId);
    const links = t.relay.store.linksFor(b.incidentId!);
    expect(links.some((l) => l.kind === 'related' && l.relatedId === a.incidentId)).toBe(true);
  });

  it('learns from manual merges and splits', async () => {
    const t = await createTestRelay();
    const one = { title: 'Redis evictions', service: 'cache', fingerprint: 'redis-evict' };
    const two = { title: 'Login latency', service: 'auth', fingerprint: 'login-latency' };
    const [a] = await t.relay.ingest(one);
    const [b] = await t.relay.ingest(two);
    expect(a.incidentId).not.toBe(b.incidentId);

    const source = t.relay.store.getIncident(b.incidentId!)!;
    const target = t.relay.store.getIncident(a.incidentId!)!;
    t.relay.incidents.merge(source, target, 'alice', t.clock.now());
    expect(t.relay.store.getIncident(source.id)!.resolvedBy).toBe(`merge:#${target.number}`);

    // Both problems resolve, then occur again later: now they are grouped automatically.
    t.relay.incidents.resolve(t.relay.store.getIncident(target.id)!, 'alice', t.clock.now());
    t.clock.advance(2 * 60 * MINUTE);
    const [c] = await t.relay.ingest(one);
    t.clock.advance(30_000);
    const [d] = await t.relay.ingest(two);
    expect(d.incidentId).toBe(c.incidentId);
    const reasons = t.relay.store.timeline(c.incidentId!).find((e) => e.kind === 'alert_added')?.data?.reasons as string[];
    expect(reasons.join()).toContain('Gelernte Verknüpfung');

    // Splitting teaches the opposite.
    const alert = t.relay.store.getAlert(d.alertId!)!;
    const split = t.relay.incidents.detach(alert, 'bob', t.clock.now());
    expect(split.id).not.toBe(c.incidentId);
    expect(t.relay.learned('redis-evict', 'login-latency')).toBe(-1);
  });
});

describe('noise control', () => {
  it('detects flapping alerts and suppresses re-notifications', async () => {
    const t = await createTestRelay();
    const ch = t.channel('ops');
    t.route({ channels: [ch] });
    const ev = { title: 'VPN tunnel down', fingerprint: 'vpn', severity: 'high' as const };
    for (let i = 0; i < 4; i++) {
      await t.relay.ingest(ev);
      t.clock.advance(MINUTE);
      await t.relay.ingest({ ...ev, status: 'resolved' });
      t.clock.advance(MINUTE);
    }
    await t.relay.ingest(ev);
    await t.tick();

    const alert = t.relay.store.latestAlertByFingerprint('vpn')!;
    expect(alert.flapping).toBe(true);
    const kinds = t.sent.map((s) => s.message.kind);
    // opened, resolved, reopened, resolved – then flapping kicks in and everything stays quiet.
    expect(kinds.length).toBeLessThan(8);
    expect(t.relay.store.timeline(alert.incidentId!).some((e) => e.kind === 'flapping')).toBe(true);
  });

  it('bundles an alert storm into a single incident', async () => {
    const t = await createTestRelay({ settings: { storm: { enabled: true, windowSeconds: 60, threshold: 5 } } });
    const ch = t.channel('ops');
    t.route({ channels: [ch] });
    for (let i = 0; i < 20; i++) {
      await t.relay.ingest({ title: `Service ${String.fromCharCode(65 + i)} unhealthy`, service: `svc-${String.fromCharCode(97 + i)}`, source: `src${i}` });
      t.clock.advance(1000);
    }
    await t.tick();
    const { items } = t.relay.store.listIncidents({});
    const storm = items.find((i) => i.storm)!;
    expect(storm).toBeDefined();
    expect(storm.alertCount).toBe(16);
    expect(items).toHaveLength(5);
    expect(t.sent.length).toBeLessThanOrEqual(5);
  });

  it('raises severity by volume', async () => {
    const t = await createTestRelay({
      settings: { volumeRules: [{ name: '5xx flood', matchers: ['service = api'], count: 10, windowMinutes: 5, raiseTo: 'critical' }] },
    });
    const ch = t.channel('ops');
    t.route({ channels: [ch], delivery: 'immediate' });
    for (let i = 0; i < 12; i++) {
      await t.relay.ingest({ title: 'HTTP 502 from upstream', service: 'api', severity: 'warning' });
      t.clock.advance(5000);
    }
    await t.tick();
    const incident = t.relay.store.listIncidents({}).items[0];
    expect(incident.severity).toBe('critical');
    expect(t.sent.map((s) => s.message.kind)).toEqual(['incident.opened', 'incident.severity']);
  });

  it('applies event rules', async () => {
    const t = await createTestRelay({
      settings: {
        eventRules: [
          { name: 'drop debug', matchers: ['severity <= debug'], drop: true },
          { name: 'prod is critical', matchers: ['labels.env = prod', 'source = github'], set: { severity: 'critical', labels: { team: 'platform' } } },
        ],
      },
    });
    const [dropped] = await t.relay.ingest({ title: 'noise', severity: 'debug' });
    expect(dropped.action).toBe('dropped');
    const [kept] = await t.relay.ingest({ title: 'Deploy failed', source: 'github', severity: 'warning', labels: { env: 'prod' } });
    const alert = t.relay.store.getAlert(kept.alertId!)!;
    expect(alert.severity).toBe('critical');
    expect(alert.labels.team).toBe('platform');
  });

  it('auto-resolves alerts without resolve events after the timeout', async () => {
    const t = await createTestRelay({ settings: { dedup: { reopenWindowMinutes: 30, autoResolveMinutes: 60 } } });
    const [res] = await t.relay.ingest({ title: 'Cron job failed' });
    const [kept] = await t.relay.ingest({ title: 'Long running', ttl: 0, source: 'other' });
    await t.advance(61 * MINUTE);
    expect(t.relay.store.getIncident(res.incidentId!)!.status).toBe('resolved');
    expect(t.relay.store.getIncident(kept.incidentId!)!.status).toBe('open');
  });
});

describe('notifications', () => {
  it('sends critical immediately and collects warnings into a digest', async () => {
    const t = await createTestRelay();
    const ch = t.channel('ops');
    t.route({ channels: [ch], delivery: 'auto', digestMinutes: 15 });

    await t.relay.ingest({ title: 'Database down', service: 'db', severity: 'critical' });
    await t.relay.ingest({ title: 'Disk 80%', service: 'files', host: 'nas', severity: 'warning' });
    await t.relay.ingest({ title: 'Certificate renews soon', service: 'web', host: 'proxy', severity: 'info', source: 'certbot' });
    await t.tick();
    expect(t.sent.map((s) => s.message.kind)).toEqual(['incident.opened']);

    await t.advance(16 * MINUTE);
    expect(t.sent.map((s) => s.message.kind)).toEqual(['incident.opened', 'digest']);
    const digest = t.sent[1].message;
    expect(digest.items).toHaveLength(2);
    expect(digest.title).toContain('2 Vorfälle');
  });

  it('holds non-critical notifications during quiet hours', async () => {
    const t = await createTestRelay();
    const ch = t.channel('ops');
    // 10:00 UTC lies inside 09:00–11:00 UTC quiet hours.
    t.route({ channels: [ch], quietHours: { start: '09:00', end: '11:00', timezone: 'UTC' } });
    await t.relay.ingest({ title: 'Backup slow', severity: 'high', ttl: 0 });
    await t.relay.ingest({ title: 'Everything down', severity: 'critical', service: 'core', source: 'x', ttl: 0 });
    await t.tick();
    expect(t.sent.map((s) => s.message.title)).toEqual([expect.stringContaining('Everything down')]);
    await t.advance(61 * MINUTE);
    expect(t.sent.at(-1)!.message.kind).toBe('digest');
  });

  it('respects silences and notifies once they expire', async () => {
    const t = await createTestRelay();
    const ch = t.channel('ops');
    t.route({ channels: [ch] });
    const now = t.clock.now();
    t.relay.store.upsertSilence({ id: 'sil_1', matchers: ['service = nas'], startsAt: now, endsAt: now + 30 * MINUTE, comment: 'Wartung', createdBy: 'me', createdAt: now });

    const [res] = await t.relay.ingest({ title: 'NAS offline', service: 'nas', severity: 'high', ttl: 0 });
    await t.tick();
    expect(t.sent).toHaveLength(0);
    expect(t.relay.store.getIncident(res.incidentId!)!.notifyState).toBe('suppressed');

    await t.advance(31 * MINUTE);
    expect(t.sent).toHaveLength(1);
  });

  it('routes by matchers and honours "stop"', async () => {
    const t = await createTestRelay();
    const pager = t.channel('pager');
    const chat = t.channel('chat');
    t.route({ channels: [pager], matchers: ['severity >= critical'], stop: true });
    t.route({ channels: [chat] });
    await t.relay.ingest({ title: 'Prod down', severity: 'critical' });
    await t.relay.ingest({ title: 'Minor glitch', severity: 'high', source: 'other', service: 'x' });
    await t.tick();
    expect(t.sent.map((s) => `${s.channel}:${s.message.incident?.title}`).sort()).toEqual(['chat:Minor glitch', 'pager:Prod down']);
  });

  it('notifies about severity increases', async () => {
    const t = await createTestRelay();
    const ch = t.channel('ops');
    t.route({ channels: [ch] });
    await t.relay.ingest({ title: 'Disk usage', fingerprint: 'disk', severity: 'high' });
    await t.relay.ingest({ title: 'Disk usage', fingerprint: 'disk', severity: 'critical' });
    await t.tick();
    expect(t.sent.map((s) => s.message.kind)).toEqual(['incident.opened', 'incident.severity']);
  });
});

describe('escalation', () => {
  it('escalates unacknowledged incidents step by step and stops on ack', async () => {
    const t = await createTestRelay();
    const chat = t.channel('chat');
    const phone = t.channel('phone');
    const boss = t.channel('boss');
    const policy = t.relay.store.upsertPolicy(
      { id: 'esc_1', name: 'Standard', repeat: 0, steps: [{ delayMinutes: 10, channels: [phone] }, { delayMinutes: 20, channels: [boss] }] },
      t.clock.now(),
    );
    t.route({ channels: [chat], escalationPolicyId: policy.id });

    const [res] = await t.relay.ingest({ title: 'Payment provider unreachable', severity: 'critical' });
    await t.tick();
    expect(t.sent.map((s) => s.channel)).toEqual(['chat']);

    await t.advance(10 * MINUTE);
    expect(t.sent.map((s) => s.channel)).toEqual(['chat', 'phone']);
    expect(t.sent[1].message.kind).toBe('incident.escalated');
    expect(t.sent[1].message.title).toContain('Stufe 1');

    const incident = t.relay.store.getIncident(res.incidentId!)!;
    t.relay.incidents.acknowledge(incident, 'alice', t.clock.now());
    await t.advance(30 * MINUTE);
    expect(t.sent.map((s) => s.channel)).toEqual(['chat', 'phone']);
  });

  it('repeats the chain and notifies escalation channels on resolve', async () => {
    const t = await createTestRelay();
    const chat = t.channel('chat');
    const phone = t.channel('phone');
    t.relay.store.upsertPolicy({ id: 'esc_r', name: 'Repeat', repeat: 1, steps: [{ delayMinutes: 5, channels: [phone] }] }, t.clock.now());
    t.route({ channels: [chat], escalationPolicyId: 'esc_r' });
    const [res] = await t.relay.ingest({ title: 'Outage', severity: 'critical', fingerprint: 'outage' });
    await t.advance(5 * MINUTE);
    await t.advance(5 * MINUTE);
    await t.advance(5 * MINUTE);
    expect(t.sent.filter((s) => s.channel === 'phone')).toHaveLength(2);

    await t.relay.ingest({ title: 'Outage', status: 'resolved', fingerprint: 'outage' });
    await t.tick();
    expect(t.relay.store.getIncident(res.incidentId!)!.status).toBe('resolved');
    expect(t.sent.filter((s) => s.message.kind === 'incident.resolved').map((s) => s.channel).sort()).toEqual(['chat', 'phone']);
  });
});

describe('delivery queue', () => {
  it('retries with backoff and keeps per-channel order', async () => {
    const t = await createTestRelay();
    const ch = t.channel('ops');
    t.route({ channels: [ch] });
    t.failNext(2);
    await t.relay.ingest({ title: 'First', severity: 'critical', source: 'a' });
    await t.relay.ingest({ title: 'Second', severity: 'critical', source: 'b', service: 'other' });
    await t.tick();
    expect(t.sent).toHaveLength(0);
    const pending = t.relay.store.listDeliveries({ status: 'pending' });
    expect(pending).toHaveLength(2);
    expect(pending.find((d) => d.message.title.includes('First'))!.attempts).toBe(1);

    await t.advance(10_000);
    await t.advance(30_000);
    expect(t.sent.map((s) => s.message.title)).toEqual([expect.stringContaining('First'), expect.stringContaining('Second')]);
    expect(t.relay.store.getChannel(ch)!.consecutiveFailures).toBe(0);
  });

  it('marks permanent failures as failed and allows a manual retry', async () => {
    const t = await createTestRelay();
    const ch = t.channel('ops');
    t.route({ channels: [ch] });
    t.failNext(1, false);
    await t.relay.ingest({ title: 'Bad config', severity: 'critical' });
    await t.tick();
    const [failed] = t.relay.store.listDeliveries({ status: 'failed' });
    expect(failed.lastError).toContain('simulated outage');
    expect(t.relay.store.retryDelivery(failed.id, t.clock.now())).toBe(true);
    await t.tick();
    expect(t.sent).toHaveLength(1);
  });
});
