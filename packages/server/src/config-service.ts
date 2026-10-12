import { z } from 'zod';
import { validateMatchers } from './engine/matcher.js';
import type { OpenRelay } from './relay.js';
import { SEVERITIES, type Channel, type EscalationPolicy, type Route, type ServiceDependency, type Silence } from './types.js';
import { newId } from './util/ids.js';
import { parseClock, MINUTE } from './util/time.js';

export const SECRET_MASK = '••••••';

export class ConfigError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

function zodMessage(error: z.ZodError): string {
  return error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ');
}

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw new ConfigError(zodMessage(result.error));
  return result.data;
}

const id = z.string().trim().min(1).max(64).regex(/^[\w.-]+$/, 'nur Buchstaben, Ziffern, ".", "-" und "_"');
const matchers = z.array(z.string()).max(50).superRefine((value, ctx) => {
  for (const message of validateMatchers(value)) ctx.addIssue({ code: 'custom', message });
});

const quietHours = z
  .object({
    start: z.string(),
    end: z.string(),
    timezone: z.string().optional().nullable(),
    bypassSeverity: z.enum(SEVERITIES).optional().nullable(),
  })
  .superRefine((q, ctx) => {
    for (const key of ['start', 'end'] as const) {
      try {
        parseClock(q[key]);
      } catch (err) {
        ctx.addIssue({ code: 'custom', path: [key], message: (err as Error).message });
      }
    }
    if (q.timezone) {
      try {
        new Intl.DateTimeFormat('en-US', { timeZone: q.timezone });
      } catch {
        ctx.addIssue({ code: 'custom', path: ['timezone'], message: `Unbekannte Zeitzone: ${q.timezone}` });
      }
    }
  });

export const channelInput = z.object({
  id: id.optional(),
  name: z.string().trim().min(1).max(100),
  type: z.string().trim().min(1),
  config: z.record(z.string(), z.unknown()).default({}),
  enabled: z.boolean().default(true),
});

export const routeInput = z.object({
  id: id.optional(),
  name: z.string().trim().min(1).max(100),
  position: z.number().int().optional(),
  enabled: z.boolean().default(true),
  matchers: matchers.default([]),
  channels: z.array(z.string()).max(50).default([]),
  delivery: z.enum(['auto', 'immediate', 'digest']).default('auto'),
  digestMinutes: z.number().int().min(1).max(1440).nullable().optional(),
  escalationPolicyId: z.string().nullable().optional(),
  quietHours: quietHours.nullable().optional(),
  notifyResolved: z.boolean().default(true),
  stop: z.boolean().default(false),
});

export const policyInput = z
  .object({
    id: id.optional(),
    name: z.string().trim().min(1).max(100),
    steps: z
      .array(z.object({ delayMinutes: z.number().min(0).max(10_080), channels: z.array(z.string()).min(1, 'mindestens ein Kanal pro Stufe') }))
      .min(1, 'mindestens eine Stufe'),
    repeat: z.number().int().min(0).max(20).default(0),
  })
  .refine((p) => p.repeat === 0 || p.steps.some((s) => s.delayMinutes >= 1), {
    message: 'Bei Wiederholungen braucht mindestens eine Stufe eine Verzögerung ≥ 1 min',
  });

export const silenceInput = z
  .object({
    id: id.optional(),
    matchers: matchers.refine((m) => m.length > 0, 'mindestens eine Bedingung'),
    startsAt: z.number().optional(),
    endsAt: z.number().optional(),
    durationMinutes: z.number().min(1).max(525_600).optional(),
    comment: z.string().max(500).nullable().optional(),
  })
  .refine((s) => s.endsAt !== undefined || s.durationMinutes !== undefined, { message: 'endsAt oder durationMinutes erforderlich' });

export const dependencyInput = z.array(
  z
    .object({ service: z.string().trim().min(1).max(200), dependsOn: z.string().trim().min(1).max(200) })
    .refine((d) => d.service.toLowerCase() !== d.dependsOn.toLowerCase(), { message: 'Ein Service kann nicht von sich selbst abhängen' }),
);

/** Validated CRUD for configuration entities (shared by the HTTP API and YAML provisioning). */
export class ConfigService {
  constructor(private readonly relay: OpenRelay) {}

  private get store() {
    return this.relay.store;
  }

  private now(): number {
    return this.relay.clock.now();
  }

  // ------------------------------------------------------------ channels
  secretKeys(type: string): string[] {
    return (this.relay.registry.channel(type)?.configSchema ?? []).filter((f) => f.type === 'secret').map((f) => f.key);
  }

  maskChannel(channel: Channel): Channel {
    const config = { ...channel.config };
    for (const key of this.secretKeys(channel.type)) {
      if (config[key] !== undefined && config[key] !== '') config[key] = SECRET_MASK;
    }
    return { ...channel, config };
  }

  saveChannel(input: unknown, existingId?: string): Channel {
    const current = existingId ? this.store.getChannel(existingId) : undefined;
    if (existingId && !current) throw new ConfigError('Kanal nicht gefunden', 404);
    // PUT may be partial (e.g. only `enabled`); secrets stay masked and are restored below.
    const merged =
      current && typeof input === 'object' && input
        ? { name: current.name, type: current.type, config: this.maskChannel(current).config, enabled: current.enabled, ...(input as object) }
        : input;
    const data = parse(channelInput, merged);
    const plugin = this.relay.registry.channel(data.type);
    if (!plugin) throw new ConfigError(`Unbekannter Kanaltyp "${data.type}"`);
    const channelId = existingId ?? data.id ?? newId('ch', this.now());
    const existing = current ?? this.store.getChannel(channelId);

    const config: Record<string, unknown> = {};
    for (const field of plugin.configSchema) {
      let value = data.config[field.key];
      if (value === SECRET_MASK) value = existing?.type === data.type ? existing.config[field.key] : undefined;
      if (value === undefined || value === null || value === '') {
        if (field.default !== undefined) value = field.default;
        else if (field.required) throw new ConfigError(`${field.label} ist erforderlich`);
        else continue;
      }
      if (field.type === 'number') value = Number(value);
      if (field.type === 'boolean') value = value === true || value === 'true';
      if (field.type === 'select' && field.options && !field.options.some((o) => o.value === value)) {
        throw new ConfigError(`${field.label}: ungültiger Wert`);
      }
      config[field.key] = value;
    }
    const problems = plugin.validate?.(config) ?? [];
    if (problems && problems.length) throw new ConfigError(problems.join('; '));
    return this.store.upsertChannel({ id: channelId, name: data.name, type: data.type, config, enabled: data.enabled }, this.now());
  }

  deleteChannel(channelId: string): void {
    this.store.tx(() => {
      if (!this.store.deleteChannel(channelId)) throw new ConfigError('Kanal nicht gefunden', 404);
      const now = this.now();
      for (const route of this.store.listRoutes()) {
        if (route.channels.includes(channelId)) {
          this.store.upsertRoute({ ...route, channels: route.channels.filter((c) => c !== channelId) }, now);
        }
      }
      for (const policy of this.store.listPolicies()) {
        if (policy.steps.some((s) => s.channels.includes(channelId))) {
          const steps = policy.steps
            .map((s) => ({ ...s, channels: s.channels.filter((c) => c !== channelId) }))
            .filter((s) => s.channels.length > 0);
          this.store.upsertPolicy({ ...policy, steps }, now);
        }
      }
    });
  }

  private assertChannels(ids: string[]): void {
    for (const channelId of ids) {
      if (!this.store.getChannel(channelId)) throw new ConfigError(`Kanal "${channelId}" existiert nicht`);
    }
  }

  // ------------------------------------------------------------ routes
  saveRoute(input: unknown, existingId?: string): Route {
    const existing = existingId ? this.store.getRoute(existingId) : undefined;
    if (existingId && !existing) throw new ConfigError('Regel nicht gefunden', 404);
    const merged = existing && typeof input === 'object' && input ? { ...existing, ...(input as object) } : input;
    const data = parse(routeInput, merged);
    this.assertChannels(data.channels);
    if (data.escalationPolicyId && !this.store.getPolicy(data.escalationPolicyId)) {
      throw new ConfigError(`Eskalationsrichtlinie "${data.escalationPolicyId}" existiert nicht`);
    }
    const routeId = existingId ?? data.id ?? newId('rt', this.now());
    const position = data.position ?? this.store.getRoute(routeId)?.position ?? this.store.maxRoutePosition() + 1;
    return this.store.upsertRoute(
      {
        id: routeId,
        name: data.name,
        position,
        enabled: data.enabled,
        matchers: data.matchers,
        channels: [...new Set(data.channels)],
        delivery: data.delivery,
        digestMinutes: data.digestMinutes ?? null,
        escalationPolicyId: data.escalationPolicyId || null,
        quietHours: data.quietHours
          ? {
              start: data.quietHours.start,
              end: data.quietHours.end,
              ...(data.quietHours.timezone ? { timezone: data.quietHours.timezone } : {}),
              ...(data.quietHours.bypassSeverity ? { bypassSeverity: data.quietHours.bypassSeverity } : {}),
            }
          : null,
        notifyResolved: data.notifyResolved,
        stop: data.stop,
      },
      this.now(),
    );
  }

  deleteRoute(routeId: string): void {
    if (!this.store.deleteRoute(routeId)) throw new ConfigError('Regel nicht gefunden', 404);
  }

  // ------------------------------------------------------------ escalation policies
  savePolicy(input: unknown, existingId?: string): EscalationPolicy {
    if (existingId && !this.store.getPolicy(existingId)) throw new ConfigError('Richtlinie nicht gefunden', 404);
    const data = parse(policyInput, input);
    for (const step of data.steps) this.assertChannels(step.channels);
    const policyId = existingId ?? data.id ?? newId('esc', this.now());
    return this.store.upsertPolicy({ id: policyId, name: data.name, steps: data.steps, repeat: data.repeat }, this.now());
  }

  deletePolicy(policyId: string): void {
    this.store.tx(() => {
      if (!this.store.deletePolicy(policyId)) throw new ConfigError('Richtlinie nicht gefunden', 404);
      const now = this.now();
      for (const route of this.store.listRoutes()) {
        if (route.escalationPolicyId === policyId) this.store.upsertRoute({ ...route, escalationPolicyId: null }, now);
      }
    });
  }

  // ------------------------------------------------------------ silences
  saveSilence(input: unknown, createdBy: string | null, existingId?: string): Silence {
    const existing = existingId ? this.store.getSilence(existingId) : undefined;
    if (existingId && !existing) throw new ConfigError('Stummschaltung nicht gefunden', 404);
    const merged =
      existing && typeof input === 'object' && input
        ? { matchers: existing.matchers, startsAt: existing.startsAt, endsAt: existing.endsAt, comment: existing.comment, ...(input as object) }
        : input;
    const data = parse(silenceInput, merged);
    const now = this.now();
    const startsAt = data.startsAt ?? existing?.startsAt ?? now;
    const endsAt = data.durationMinutes !== undefined ? Math.max(startsAt, now) + data.durationMinutes * MINUTE : data.endsAt!;
    if (endsAt < startsAt) throw new ConfigError('Ende liegt vor dem Beginn');
    return this.store.upsertSilence({
      id: existingId ?? data.id ?? newId('sil', now),
      matchers: data.matchers,
      startsAt,
      endsAt,
      comment: data.comment ?? null,
      createdBy: existing?.createdBy ?? createdBy,
      createdAt: existing?.createdAt ?? now,
    });
  }

  // ------------------------------------------------------------ topology
  setDependencies(input: unknown): ServiceDependency[] {
    const items = parse(dependencyInput, input);
    this.relay.setDependencies(items);
    return this.store.listDependencies();
  }
}
