import { z } from 'zod';
import { SEVERITIES, type EngineSettings } from '../types.js';
import { deepMerge } from '../util/json.js';
import { validateMatchers } from './matcher.js';

export const DEFAULT_SETTINGS: EngineSettings = {
  locale: 'de',
  dedup: {
    reopenWindowMinutes: 30,
    autoResolveMinutes: 60,
  },
  correlation: {
    enabled: true,
    windowMinutes: 15,
    threshold: 0.6,
    relatedThreshold: 0.35,
    groupByLabels: ['cluster', 'namespace', 'deployment', 'region', 'env', 'environment'],
    weights: {
      learned: 0.9,
      topology: 0.75,
      service: 0.6,
      host: 0.5,
      label: 0.3,
      similarity: 0.5,
      source: 0.15,
    },
  },
  flapping: {
    enabled: true,
    windowMinutes: 30,
    threshold: 4,
  },
  storm: {
    enabled: true,
    windowSeconds: 60,
    threshold: 30,
  },
  notifications: {
    immediateSeverity: 'high',
    digestMinutes: 15,
    criticalBypassDigest: true,
  },
  priority: {
    wideImpactServices: 3,
  },
  recurrence: {
    lookbackDays: 30,
  },
  retention: {
    eventsDays: 14,
    resolvedIncidentsDays: 180,
    deliveriesDays: 30,
  },
  volumeRules: [],
  eventRules: [],
};

const severity = z.enum(SEVERITIES);
const matchers = z.array(z.string()).superRefine((value, ctx) => {
  for (const message of validateMatchers(value)) ctx.addIssue({ code: 'custom', message });
});
const weight = z.number().min(0).max(1);

export const settingsSchema = z.object({
  locale: z.enum(['de', 'en']),
  dedup: z.object({
    reopenWindowMinutes: z.number().min(0).max(10_080),
    autoResolveMinutes: z.number().min(0).max(525_600),
  }),
  correlation: z.object({
    enabled: z.boolean(),
    windowMinutes: z.number().min(1).max(1440),
    threshold: weight,
    relatedThreshold: weight,
    groupByLabels: z.array(z.string().min(1)).max(50),
    weights: z.object({
      learned: weight,
      topology: weight,
      service: weight,
      host: weight,
      label: weight,
      similarity: weight,
      source: weight,
    }),
  }),
  flapping: z.object({
    enabled: z.boolean(),
    windowMinutes: z.number().min(1).max(1440),
    threshold: z.number().int().min(2).max(1000),
  }),
  storm: z.object({
    enabled: z.boolean(),
    windowSeconds: z.number().min(5).max(3600),
    threshold: z.number().int().min(2).max(100_000),
  }),
  notifications: z.object({
    immediateSeverity: severity,
    digestMinutes: z.number().min(1).max(1440),
    criticalBypassDigest: z.boolean(),
  }),
  priority: z.object({
    wideImpactServices: z.number().int().min(0).max(1000),
  }),
  recurrence: z.object({
    lookbackDays: z.number().min(0).max(365),
  }),
  retention: z.object({
    eventsDays: z.number().min(1).max(3650),
    resolvedIncidentsDays: z.number().min(1).max(3650),
    deliveriesDays: z.number().min(1).max(3650),
  }),
  volumeRules: z
    .array(
      z.object({
        name: z.string().min(1),
        matchers,
        count: z.number().int().min(2),
        windowMinutes: z.number().min(1).max(1440),
        raiseTo: severity,
      }),
    )
    .max(100),
  eventRules: z
    .array(
      z.object({
        name: z.string().min(1),
        matchers,
        drop: z.boolean().optional(),
        set: z
          .object({
            severity: severity.optional(),
            service: z.string().optional(),
            host: z.string().optional(),
            correlationKey: z.string().optional(),
            labels: z.record(z.string(), z.string()).optional(),
          })
          .optional(),
      }),
    )
    .max(200),
});

export class SettingsError extends Error {
  constructor(readonly issues: string[]) {
    super(`Ungültige Einstellungen: ${issues.join('; ')}`);
  }
}

/** Merges a (partial) patch onto `base` and validates the result. */
export function mergeSettings(base: EngineSettings, patch: unknown): EngineSettings {
  const merged = deepMerge(base, patch ?? {});
  const result = settingsSchema.safeParse(merged);
  if (!result.success) {
    throw new SettingsError(result.error.issues.map((i) => `${i.path.join('.') || 'settings'}: ${i.message}`));
  }
  return result.data as EngineSettings;
}
