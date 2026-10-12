import type { FastifyInstance, FastifyRequest } from 'fastify';
import { parseLabelList } from '../../plugins/adapters/text.js';
import type { AdapterRequest } from '../../plugins/types.js';
import type { EventInput } from '../../types.js';
import { ApiError, type AppContext } from '../server.js';

const MAX_BATCH = 1000;

function headerMap(req: FastifyRequest): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(req.headers)) out[k.toLowerCase()] = Array.isArray(v) ? v.join(', ') : v;
  return out;
}

function queryMap(req: FastifyRequest): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries((req.query ?? {}) as Record<string, unknown>)) {
    if (k === 'token') continue;
    out[k] = Array.isArray(v) ? String(v[0]) : v === undefined ? undefined : String(v);
  }
  return out;
}

/** Query parameters override adapter output, e.g. `?source=grafana-prod&labels=env=prod`. */
function applyOverrides(events: EventInput[], query: Record<string, string | undefined>): EventInput[] {
  const labels = parseLabelList(query.labels);
  return events.map((e) => {
    if (!e || typeof e !== 'object') return e;
    const out: EventInput = { ...e };
    if (query.source) out.source = query.source;
    if (query.severity) out.severity = query.severity as EventInput['severity'];
    if (query.service) out.service = query.service;
    if (query.host) out.host = query.host;
    if (Object.keys(labels).length) out.labels = { ...(e.labels ?? {}), ...labels };
    return out;
  });
}

export function registerIngestRoutes(app: FastifyInstance, ctx: AppContext): void {
  const ingest = async (req: FastifyRequest, events: EventInput[]) => {
    if (events.length > MAX_BATCH) throw new ApiError(413, `Höchstens ${MAX_BATCH} Ereignisse pro Anfrage`);
    const results = await ctx.relay.ingest(events, { defaultSource: req.principal?.defaultSource });
    return { accepted: results.filter((r) => r.action !== 'dropped').length, results };
  };

  app.post('/api/v1/events', { config: { scope: 'ingest' } }, async (req, reply) => {
    const adapter = ctx.relay.registry.adapter('generic')!;
    const events = await adapter.parse(
      { body: req.body, rawBody: req.rawBody, headers: headerMap(req), query: queryMap(req) },
      { logger: ctx.relay.logger, env: (name) => ctx.env[name] },
    );
    return reply.status(202).send(await ingest(req, applyOverrides(events, queryMap(req))));
  });

  app.post<{ Params: { adapter: string } }>('/api/v1/ingest/:adapter', { config: { scope: 'ingest' } }, async (req, reply) => {
    const adapter = ctx.relay.registry.adapter(req.params.adapter);
    if (!adapter) throw new ApiError(404, `Unbekannter Adapter "${req.params.adapter}"`);
    const request: AdapterRequest = { body: req.body, rawBody: req.rawBody, headers: headerMap(req), query: queryMap(req) };
    const events = await adapter.parse(request, { logger: ctx.relay.logger, env: (name) => ctx.env[name] });
    return reply.status(202).send(await ingest(req, applyOverrides(events, request.query)));
  });
}
