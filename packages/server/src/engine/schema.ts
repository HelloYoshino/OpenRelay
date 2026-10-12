import { z } from 'zod';
import type { EventInput, EventStatus, NormalizedEvent } from '../types.js';
import { parseSeverity } from './severity.js';

const optionalText = (max: number) =>
  z
    .union([z.string(), z.number()])
    .transform((v) => String(v).trim())
    .pipe(z.string().max(max))
    .optional()
    .nullable();

const STATUS_ALIASES: Record<string, EventStatus> = {
  firing: 'firing',
  fire: 'firing',
  problem: 'firing',
  alert: 'firing',
  alerting: 'firing',
  triggered: 'firing',
  down: 'firing',
  error: 'firing',
  failed: 'firing',
  open: 'firing',
  resolved: 'resolved',
  resolve: 'resolved',
  ok: 'resolved',
  up: 'resolved',
  recovered: 'resolved',
  recovery: 'resolved',
  closed: 'resolved',
  success: 'resolved',
  normal: 'resolved',
};

export const eventInputSchema = z.preprocess(
  (raw) => {
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      const r = raw as Record<string, unknown>;
      if (r.title === undefined || r.title === null || r.title === '') {
        const alias = r.summary ?? r.subject ?? r.name ?? r.alertname;
        if (alias !== undefined) return { ...r, title: alias };
      }
    }
    return raw;
  },
  z.object({
    title: z
      .union([z.string(), z.number()])
      .transform((v) => String(v).trim())
      .pipe(z.string().min(1, 'title darf nicht leer sein').max(500)),
    source: optionalText(100),
    message: optionalText(20_000),
    severity: z.union([z.string(), z.number()]).optional().nullable(),
    status: z
      .string()
      .optional()
      .nullable()
      .refine((v) => !v || STATUS_ALIASES[v.toLowerCase()] !== undefined, { message: 'status muss "firing" oder "resolved" sein' }),
    type: optionalText(200),
    service: optionalText(200),
    host: optionalText(255),
    fingerprint: optionalText(256),
    correlationKey: optionalText(256),
    labels: z
      .record(z.string().max(100), z.union([z.string(), z.number(), z.boolean(), z.null()]))
      .optional()
      .nullable()
      .refine((v) => !v || Object.keys(v).length <= 64, { message: 'höchstens 64 Labels' }),
    url: optionalText(2000),
    timestamp: z.union([z.string(), z.number()]).optional().nullable(),
    ttl: z.number().int().min(0).max(31_536_000).optional().nullable(),
    payload: z.unknown().optional(),
  }),
);

export type ValidEventInput = z.infer<typeof eventInputSchema>;

export class EventValidationError extends Error {
  constructor(readonly issues: string[]) {
    super(issues.join('; '));
  }
}

export function validateEventInput(input: unknown): EventInput {
  const result = eventInputSchema.safeParse(input);
  if (!result.success) {
    throw new EventValidationError(result.error.issues.map((i) => `${i.path.join('.') || 'event'}: ${i.message}`));
  }
  return result.data as unknown as EventInput;
}

function parseTimestamp(value: unknown, fallback: number): number {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'number' || /^\d+(\.\d+)?$/.test(String(value))) {
    const n = Number(value);
    return n < 1e12 ? Math.round(n * 1000) : Math.round(n);
  }
  const parsed = Date.parse(String(value));
  return Number.isNaN(parsed) ? fallback : parsed;
}

const clean = (v: string | null | undefined): string | null => (v === undefined || v === null || v === '' ? null : v);

/** Fills defaults; the fingerprint stays empty unless given (computed after event rules ran). */
export function normalizeEvent(input: EventInput, defaults: { source?: string | null }, now: number): NormalizedEvent {
  const labels: Record<string, string> = {};
  for (const [k, v] of Object.entries(input.labels ?? {})) {
    if (v !== null && v !== undefined) labels[k] = String(v);
  }
  const status = input.status ? STATUS_ALIASES[String(input.status).toLowerCase()] ?? 'firing' : 'firing';
  return {
    title: String(input.title).trim(),
    source: clean(input.source as string | null) ?? defaults.source ?? 'api',
    message: clean(input.message as string | null),
    severity: parseSeverity(input.severity, 'warning'),
    status,
    type: clean(input.type as string | null),
    service: clean(input.service as string | null),
    host: clean(input.host as string | null),
    fingerprint: clean(input.fingerprint as string | null) ?? '',
    correlationKey: clean(input.correlationKey as string | null),
    labels,
    url: clean(input.url as string | null),
    occurredAt: parseTimestamp(input.timestamp, now),
    ttl: input.ttl === undefined || input.ttl === null ? null : input.ttl,
    payload: input.payload ?? null,
  };
}
