import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Incident, IncidentStatus, Severity } from '../../types.js';
import { SEVERITIES } from '../../types.js';
import { ApiError, type AppContext } from '../server.js';

const STATUSES: IncidentStatus[] = ['open', 'acknowledged', 'resolved'];

function csv<T extends string>(value: unknown, allowed: readonly T[]): T[] | undefined {
  if (typeof value !== 'string' || !value) return undefined;
  const items = value.split(',').map((v) => v.trim()) as T[];
  const invalid = items.filter((v) => !allowed.includes(v));
  if (invalid.length) throw new ApiError(400, `Ungültiger Wert: ${invalid.join(', ')}`);
  return items;
}

function int(value: unknown, fallback: number, max: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.min(Math.floor(n), max) : fallback;
}

const actorBody = z.object({ actor: z.string().trim().max(100).optional() }).passthrough();

export function registerIncidentRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { relay } = ctx;

  const load = (idOrNumber: string): Incident => {
    const incident = /^#?\d+$/.test(idOrNumber)
      ? relay.store.getIncidentByNumber(Number(idOrNumber.replace('#', '')))
      : relay.store.getIncident(idOrNumber);
    if (!incident) throw new ApiError(404, 'Vorfall nicht gefunden');
    return incident;
  };
  const actorOf = (req: { body: unknown; principal: { name: string } | null }) => {
    const parsed = actorBody.safeParse(req.body ?? {});
    return (parsed.success && parsed.data.actor) || req.principal?.name || 'api';
  };

  app.get('/api/v1/incidents', { config: { scope: 'read' } }, async (req) => {
    const q = req.query as Record<string, unknown>;
    return relay.store.listIncidents({
      status: csv(q.status, STATUSES),
      severity: csv<Severity>(q.severity, SEVERITIES),
      q: typeof q.q === 'string' ? q.q.trim() || undefined : undefined,
      limit: int(q.limit, 50, 500),
      offset: int(q.offset, 0, 1_000_000),
    });
  });

  app.get<{ Params: { id: string } }>('/api/v1/incidents/:id', { config: { scope: 'read' } }, async (req) => {
    const incident = load(req.params.id);
    const links = relay.store.linksFor(incident.id);
    const relatedIds = links.map((l) => (l.incidentId === incident.id ? l.relatedId : l.incidentId));
    const related = new Map(relay.store.getIncidentsByIds([...new Set(relatedIds)]).map((i) => [i.id, i]));
    return {
      incident,
      alerts: relay.store.alertsByIncident(incident.id, 1000),
      timeline: relay.store.timeline(incident.id, 1000),
      links: links
        .map((l) => {
          const otherId = l.incidentId === incident.id ? l.relatedId : l.incidentId;
          const other = related.get(otherId);
          if (!other) return null;
          return {
            ...l,
            related: {
              id: other.id,
              number: other.number,
              title: other.title,
              status: other.status,
              severity: other.severity,
              createdAt: other.createdAt,
              resolvedAt: other.resolvedAt,
            },
          };
        })
        .filter(Boolean),
      deliveries: relay.store.listDeliveries({ incidentId: incident.id, limit: 200 }),
    };
  });

  app.post<{ Params: { id: string } }>('/api/v1/incidents/:id/ack', { config: { scope: 'admin' } }, async (req) => {
    const incident = load(req.params.id);
    if (incident.status === 'resolved') throw new ApiError(409, 'Vorfall ist bereits gelöst');
    return { incident: relay.store.tx(() => relay.incidents.acknowledge(incident, actorOf(req), relay.clock.now())) };
  });

  app.post<{ Params: { id: string } }>('/api/v1/incidents/:id/resolve', { config: { scope: 'admin' } }, async (req) => {
    const incident = load(req.params.id);
    const note = z.object({ note: z.string().max(2000).optional() }).passthrough().safeParse(req.body ?? {});
    const result = relay.store.tx(() =>
      relay.incidents.resolve(incident, actorOf(req), relay.clock.now(), note.success ? note.data.note : undefined),
    );
    relay.deliveries.wake();
    return { incident: result };
  });

  app.post<{ Params: { id: string } }>('/api/v1/incidents/:id/reopen', { config: { scope: 'admin' } }, async (req) => {
    const incident = load(req.params.id);
    if (incident.status !== 'resolved') throw new ApiError(409, 'Vorfall ist nicht gelöst');
    const result = relay.store.tx(() => relay.incidents.reopen(incident, relay.clock.now(), actorOf(req)));
    relay.deliveries.wake();
    return { incident: result };
  });

  app.post<{ Params: { id: string } }>('/api/v1/incidents/:id/comment', { config: { scope: 'admin' } }, async (req) => {
    const incident = load(req.params.id);
    const body = z.object({ text: z.string().trim().min(1).max(5000) }).passthrough().safeParse(req.body ?? {});
    if (!body.success) throw new ApiError(400, 'text ist erforderlich');
    return { entry: relay.store.tx(() => relay.incidents.comment(incident, body.data.text, actorOf(req))) };
  });

  app.post<{ Params: { id: string } }>('/api/v1/incidents/:id/merge', { config: { scope: 'admin' } }, async (req) => {
    const source = load(req.params.id);
    const body = z.object({ targetId: z.union([z.string(), z.number()]) }).passthrough().safeParse(req.body ?? {});
    if (!body.success) throw new ApiError(400, 'targetId ist erforderlich');
    const target = load(String(body.data.targetId));
    if (source.status === 'resolved' && (source.resolvedBy ?? '').startsWith('merge')) {
      throw new ApiError(409, 'Vorfall wurde bereits zusammengeführt');
    }
    const result = relay.store.tx(() => relay.incidents.merge(source, target, actorOf(req), relay.clock.now()));
    relay.deliveries.wake();
    return { incident: result };
  });

  app.post<{ Params: { id: string } }>('/api/v1/alerts/:id/detach', { config: { scope: 'admin' } }, async (req) => {
    const alert = relay.store.getAlert(req.params.id);
    if (!alert) throw new ApiError(404, 'Alarm nicht gefunden');
    const incident = relay.store.tx(() => relay.incidents.detach(alert, actorOf(req), relay.clock.now()));
    relay.deliveries.wake();
    return { incident };
  });

  app.get('/api/v1/alerts', { config: { scope: 'read' } }, async (req) => {
    const q = req.query as Record<string, unknown>;
    const status = q.status === 'firing' || q.status === 'resolved' ? q.status : undefined;
    return relay.store.listAlerts({
      status,
      incidentId: typeof q.incidentId === 'string' ? q.incidentId : undefined,
      limit: int(q.limit, 100, 1000),
      offset: int(q.offset, 0, 1_000_000),
    });
  });

  app.get('/api/v1/events', { config: { scope: 'read' } }, async (req) => {
    const q = req.query as Record<string, unknown>;
    const severity = typeof q.severity === 'string' && (SEVERITIES as readonly string[]).includes(q.severity) ? (q.severity as Severity) : undefined;
    return {
      items: relay.store.listEvents({
        q: typeof q.q === 'string' && q.q ? q.q : undefined,
        source: typeof q.source === 'string' && q.source ? q.source : undefined,
        severity,
        alertId: typeof q.alertId === 'string' ? q.alertId : undefined,
        incidentId: typeof q.incidentId === 'string' ? q.incidentId : undefined,
        before: q.before ? Number(q.before) : undefined,
        limit: int(q.limit, 100, 1000),
      }),
    };
  });
}
