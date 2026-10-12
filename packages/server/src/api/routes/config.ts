import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { computeFingerprint } from '../../engine/fingerprint.js';
import { buildTestMessage } from '../../engine/message.js';
import { eventMatchContext } from '../../engine/notifier.js';
import { normalizeEvent, validateEventInput } from '../../engine/schema.js';
import { basePriority } from '../../engine/severity.js';
import { exportConfig, importConfig, parseConfigText } from '../../provisioning.js';
import type { DeliveryStatus } from '../../types.js';
import { ApiError, type AppContext } from '../server.js';

const DELIVERY_STATUSES: DeliveryStatus[] = ['pending', 'sending', 'sent', 'failed'];

export function registerConfigRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { relay, config } = ctx;
  const read = { config: { scope: 'read' as const } };
  const admin = { config: { scope: 'admin' as const } };

  // ------------------------------------------------------------ plugins
  app.get('/api/v1/plugins', read, async () => ({
    channels: [...relay.registry.channels.values()].map((c) => ({
      type: c.type,
      displayName: c.displayName,
      description: c.description ?? '',
      configSchema: c.configSchema,
    })),
    adapters: [...relay.registry.adapters.values()].map((a) => ({ name: a.name, description: a.description ?? '' })),
    plugins: relay.registry.plugins.map((p) => ({ name: p.name, version: p.version, builtin: p.builtin })),
  }));

  // ------------------------------------------------------------ channels
  app.get('/api/v1/channels', read, async () => ({ items: relay.store.listChannels().map((c) => config.maskChannel(c)) }));

  app.post('/api/v1/channels', admin, async (req, reply) => {
    if (typeof (req.body as { id?: unknown })?.id === 'string' && relay.store.getChannel((req.body as { id: string }).id)) {
      throw new ApiError(409, 'Ein Kanal mit dieser ID existiert bereits');
    }
    return reply.status(201).send({ channel: config.maskChannel(config.saveChannel(req.body)) });
  });

  app.put<{ Params: { id: string } }>('/api/v1/channels/:id', admin, async (req) => ({
    channel: config.maskChannel(config.saveChannel(req.body, req.params.id)),
  }));

  app.delete<{ Params: { id: string } }>('/api/v1/channels/:id', admin, async (req, reply) => {
    config.deleteChannel(req.params.id);
    return reply.status(204).send();
  });

  app.post<{ Params: { id: string } }>('/api/v1/channels/:id/test', admin, async (req, reply) => {
    const channel = relay.store.getChannel(req.params.id);
    if (!channel) throw new ApiError(404, 'Kanal nicht gefunden');
    try {
      await relay.deliveries.sendNow(channel, buildTestMessage(relay.ctx, channel.name));
      return { ok: true };
    } catch (err) {
      return reply.status(502).send({ ok: false, error: (err as Error).message });
    }
  });

  // ------------------------------------------------------------ routes
  app.get('/api/v1/routes', read, async () => ({ items: relay.store.listRoutes() }));

  app.post('/api/v1/routes', admin, async (req, reply) => {
    if (typeof (req.body as { id?: unknown })?.id === 'string' && relay.store.getRoute((req.body as { id: string }).id)) {
      throw new ApiError(409, 'Eine Regel mit dieser ID existiert bereits');
    }
    return reply.status(201).send({ route: config.saveRoute(req.body) });
  });

  app.put<{ Params: { id: string } }>('/api/v1/routes/:id', admin, async (req) => ({ route: config.saveRoute(req.body, req.params.id) }));

  app.delete<{ Params: { id: string } }>('/api/v1/routes/:id', admin, async (req, reply) => {
    config.deleteRoute(req.params.id);
    return reply.status(204).send();
  });

  app.post('/api/v1/routes/simulate', read, async (req) => {
    const body = (req.body ?? {}) as { event?: unknown };
    const input = validateEventInput(body.event ?? body);
    const now = relay.clock.now();
    const event = normalizeEvent(input, { source: req.principal?.defaultSource }, now);
    const rules = relay.pipeline.applyEventRules(event);
    if (!rules) return { context: eventMatchContext(event), dropped: true, silencedBy: null, routes: [] };
    if (!rules.fingerprint) rules.fingerprint = computeFingerprint(rules);
    const context = { ...eventMatchContext(rules), priority: basePriority(rules.severity), status: 'open' };
    return { ...relay.notifier.simulate(context, rules.severity, now), dropped: false };
  });

  // ------------------------------------------------------------ escalation policies
  app.get('/api/v1/escalation-policies', read, async () => ({ items: relay.store.listPolicies() }));

  app.post('/api/v1/escalation-policies', admin, async (req, reply) => {
    if (typeof (req.body as { id?: unknown })?.id === 'string' && relay.store.getPolicy((req.body as { id: string }).id)) {
      throw new ApiError(409, 'Eine Richtlinie mit dieser ID existiert bereits');
    }
    return reply.status(201).send({ policy: config.savePolicy(req.body) });
  });

  app.put<{ Params: { id: string } }>('/api/v1/escalation-policies/:id', admin, async (req) => ({
    policy: config.savePolicy(req.body, req.params.id),
  }));

  app.delete<{ Params: { id: string } }>('/api/v1/escalation-policies/:id', admin, async (req, reply) => {
    config.deletePolicy(req.params.id);
    return reply.status(204).send();
  });

  // ------------------------------------------------------------ silences
  app.get('/api/v1/silences', read, async (req) => {
    const active = (req.query as Record<string, unknown>).active;
    return { items: relay.store.listSilences(active === 'true' || active === '1' ? relay.clock.now() : undefined) };
  });

  app.post('/api/v1/silences', admin, async (req, reply) =>
    reply.status(201).send({ silence: config.saveSilence(req.body, req.principal?.name ?? null) }),
  );

  app.put<{ Params: { id: string } }>('/api/v1/silences/:id', admin, async (req) => ({
    silence: config.saveSilence(req.body, req.principal?.name ?? null, req.params.id),
  }));

  app.delete<{ Params: { id: string } }>('/api/v1/silences/:id', admin, async (req, reply) => {
    if (!relay.store.deleteSilence(req.params.id)) throw new ApiError(404, 'Stummschaltung nicht gefunden');
    return reply.status(204).send();
  });

  // ------------------------------------------------------------ topology
  app.get('/api/v1/topology', read, async () => {
    const items = relay.store.listDependencies();
    const services = new Set(relay.store.knownServices());
    for (const d of items) {
      services.add(d.service);
      services.add(d.dependsOn);
    }
    return { items, services: [...services].sort((a, b) => a.localeCompare(b)) };
  });

  app.put('/api/v1/topology', admin, async (req) => {
    const body = (req.body ?? {}) as { items?: unknown };
    return { items: config.setDependencies(body.items ?? body) };
  });

  // ------------------------------------------------------------ settings
  app.get('/api/v1/settings', read, async () => ({ settings: relay.settings() }));

  app.put('/api/v1/settings', admin, async (req) => {
    const body = (req.body ?? {}) as { settings?: unknown };
    return { settings: relay.updateSettings(body.settings ?? body) };
  });

  // ------------------------------------------------------------ api keys
  app.get('/api/v1/api-keys', admin, async () => ({ items: relay.store.listApiKeys() }));

  app.post('/api/v1/api-keys', admin, async (req, reply) => {
    const parsed = z
      .object({
        name: z.string().trim().min(1).max(100),
        scopes: z.array(z.enum(['ingest', 'read', 'admin'])).min(1).default(['ingest']),
        defaultSource: z.string().trim().max(100).nullable().optional(),
      })
      .safeParse(req.body ?? {});
    if (!parsed.success) throw new ApiError(400, parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
    return reply.status(201).send(ctx.auth.createApiKey(parsed.data));
  });

  app.delete<{ Params: { id: string } }>('/api/v1/api-keys/:id', admin, async (req, reply) => {
    if (!relay.store.deleteApiKey(req.params.id)) throw new ApiError(404, 'API-Key nicht gefunden');
    return reply.status(204).send();
  });

  // ------------------------------------------------------------ deliveries
  app.get('/api/v1/deliveries', read, async (req) => {
    const q = req.query as Record<string, unknown>;
    const status = DELIVERY_STATUSES.includes(q.status as DeliveryStatus) ? (q.status as DeliveryStatus) : undefined;
    return {
      items: relay.store.listDeliveries({
        status,
        channelId: typeof q.channelId === 'string' && q.channelId ? q.channelId : undefined,
        incidentId: typeof q.incidentId === 'string' && q.incidentId ? q.incidentId : undefined,
        limit: Math.min(Number(q.limit) || 100, 1000),
      }),
    };
  });

  app.post<{ Params: { id: string } }>('/api/v1/deliveries/:id/retry', admin, async (req) => {
    const id = Number(req.params.id);
    if (!relay.store.retryDelivery(id, relay.clock.now())) throw new ApiError(404, 'Keine fehlgeschlagene Zustellung mit dieser ID');
    relay.deliveries.wake();
    return { delivery: relay.store.getDelivery(id) };
  });

  // ------------------------------------------------------------ import / export
  app.get('/api/v1/config/export', admin, async (req, reply) => {
    const secrets = (req.query as Record<string, unknown>).secrets === 'true';
    return reply
      .type('text/yaml; charset=utf-8')
      .header('content-disposition', 'attachment; filename="openrelay.yaml"')
      .send(exportConfig(relay, config, secrets));
  });

  app.post('/api/v1/config/import', admin, async (req) => {
    const doc = typeof req.body === 'string' ? parseConfigText(req.body) : ((req.body ?? {}) as Record<string, unknown>);
    return { imported: importConfig(relay, config, doc, ctx.env) };
  });
}
