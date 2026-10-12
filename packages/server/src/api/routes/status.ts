import type { FastifyInstance } from 'fastify';
import { SEVERITIES, type Alert, type Incident } from '../../types.js';
import { HOUR, MINUTE } from '../../util/time.js';
import type { AppContext } from '../server.js';

function series(rows: Array<{ bucket: number; count: number }>, since: number, now: number, bucketMs: number) {
  const byBucket = new Map(rows.map((r) => [r.bucket, r.count]));
  const out: Array<{ ts: number; count: number }> = [];
  for (let b = Math.floor(since / bucketMs); b <= Math.floor(now / bucketMs); b++) {
    out.push({ ts: b * bucketMs, count: byBucket.get(b) ?? 0 });
  }
  return out;
}

export function registerStatusRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { relay } = ctx;

  app.get('/healthz', { config: { scope: 'public' } }, async () => {
    relay.db.get('SELECT 1');
    return { status: 'ok', version: relay.version, uptimeSeconds: Math.round((Date.now() - ctx.startedAt) / 1000) };
  });

  app.get('/api/v1/me', { config: { scope: 'ingest' } }, async (req) => ({
    name: req.principal!.name,
    scopes: req.principal!.scopes,
    version: relay.version,
    publicUrl: relay.publicUrl,
  }));

  app.get('/api/v1/stats', { config: { scope: 'read' } }, async (req) => {
    const hours = Math.min(Math.max(Number((req.query as Record<string, unknown>).hours) || 24, 1), 24 * 30);
    const now = relay.clock.now();
    const since = now - hours * HOUR;
    const bucketMs = Math.max(5 * MINUTE, Math.round((hours * 60) / 48) * MINUTE);
    const events = relay.store.countEventsSince(since);
    const notifications = relay.store.countSentSince(since);
    const window = relay.store.incidentWindowStats(since);
    const counts = relay.store.incidentCounts();
    const queue = relay.store.deliveryCounts();
    return {
      hours,
      incidents: {
        open: counts.open,
        acknowledged: counts.acknowledged,
        resolved: window.resolved,
        created: window.created,
        bySeverity: relay.store.openSeverityCounts(),
      },
      totals: {
        events,
        alerts: relay.store.countAlertsCreatedSince(since),
        incidents: window.created,
        notifications,
      },
      noiseReduction: events > 0 ? Math.max(0, 1 - notifications / events) : 0,
      eventsSeries: series(relay.store.eventSeries(since, bucketMs), since, now, bucketMs),
      notificationsSeries: series(relay.store.sentSeries(since, bucketMs), since, now, bucketMs),
      bucketMinutes: bucketMs / MINUTE,
      mttaMinutes: window.mttaMs === null ? null : Math.round((window.mttaMs / MINUTE) * 10) / 10,
      mttrMinutes: window.mttrMs === null ? null : Math.round((window.mttrMs / MINUTE) * 10) / 10,
      topSources: relay.store.topSources(since),
      queue: { pending: queue.pending + queue.sending, failed: queue.failed, sent: queue.sent },
    };
  });

  app.get('/metrics', { config: { scope: 'read' } }, async (_req, reply) => {
    const now = relay.clock.now();
    const bySeverity = relay.store.openSeverityCounts();
    const counts = relay.store.incidentCounts();
    const queue = relay.store.deliveryCounts();
    const lines = [
      '# HELP openrelay_incidents_open Open (unresolved) incidents by severity.',
      '# TYPE openrelay_incidents_open gauge',
      ...SEVERITIES.map((s) => `openrelay_incidents_open{severity="${s}"} ${bySeverity[s]}`),
      '# HELP openrelay_incidents_acknowledged Acknowledged incidents.',
      '# TYPE openrelay_incidents_acknowledged gauge',
      `openrelay_incidents_acknowledged ${counts.acknowledged}`,
      '# HELP openrelay_events_last_hour Events received during the last hour.',
      '# TYPE openrelay_events_last_hour gauge',
      `openrelay_events_last_hour ${relay.store.countEventsSince(now - HOUR)}`,
      '# HELP openrelay_deliveries Deliveries in the outbox by status.',
      '# TYPE openrelay_deliveries gauge',
      ...(['pending', 'sending', 'sent', 'failed'] as const).map((s) => `openrelay_deliveries{status="${s}"} ${queue[s]}`),
      '# HELP openrelay_channel_consecutive_failures Consecutive delivery failures per channel.',
      '# TYPE openrelay_channel_consecutive_failures gauge',
      ...relay.store.listChannels().map((c) => `openrelay_channel_consecutive_failures{channel="${c.id.replace(/"/g, '')}",type="${c.type}"} ${c.consecutiveFailures}`),
      '# HELP openrelay_uptime_seconds Process uptime.',
      '# TYPE openrelay_uptime_seconds counter',
      `openrelay_uptime_seconds ${Math.round((Date.now() - ctx.startedAt) / 1000)}`,
    ];
    return reply.type('text/plain; version=0.0.4').send(`${lines.join('\n')}\n`);
  });

  // ---- live stream (Server-Sent Events)
  app.get('/api/v1/stream', { config: { scope: 'read' } }, (req, reply) => {
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    res.write('retry: 3000\n\n');

    // Coalesce bursts (e.g. 200 duplicates/s) into at most a few updates per second.
    const pendingIncidents = new Map<string, Incident>();
    const pendingAlerts = new Map<string, Alert>();
    let flushTimer: NodeJS.Timeout | null = null;
    const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    const flush = () => {
      flushTimer = null;
      for (const incident of pendingIncidents.values()) send('incident', incident);
      for (const alert of pendingAlerts.values()) send('alert', alert);
      pendingIncidents.clear();
      pendingAlerts.clear();
    };
    const schedule = () => {
      if (!flushTimer) flushTimer = setTimeout(flush, 300);
    };
    const onIncident = (incident: Incident) => {
      pendingIncidents.set(incident.id, incident);
      schedule();
    };
    const onAlert = (alert: Alert) => {
      pendingAlerts.set(alert.id, alert);
      schedule();
    };
    const onDelivery = (d: unknown) => send('delivery', d);
    relay.bus.on('incident', onIncident);
    relay.bus.on('alert', onAlert);
    relay.bus.on('delivery', onDelivery);
    const ping = setInterval(() => res.write(': ping\n\n'), 25_000);

    req.raw.on('close', () => {
      clearInterval(ping);
      if (flushTimer) clearTimeout(flushTimer);
      relay.bus.off('incident', onIncident);
      relay.bus.off('alert', onAlert);
      relay.bus.off('delivery', onDelivery);
    });
  });
}
