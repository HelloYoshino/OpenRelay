import { SEVERITIES, type Severity } from '../types.js';

const RANK: Record<Severity, number> = { debug: 0, info: 1, warning: 2, high: 3, critical: 4 };

const ALIASES: Record<string, Severity> = {
  debug: 'debug',
  trace: 'debug',
  verbose: 'debug',
  info: 'info',
  information: 'info',
  informational: 'info',
  notice: 'info',
  low: 'info',
  ok: 'info',
  success: 'info',
  warning: 'warning',
  warn: 'warning',
  medium: 'warning',
  moderate: 'warning',
  minor: 'warning',
  high: 'high',
  error: 'high',
  err: 'high',
  major: 'high',
  severe: 'high',
  critical: 'critical',
  crit: 'critical',
  fatal: 'critical',
  emergency: 'critical',
  emerg: 'critical',
  alert: 'critical',
  page: 'critical',
  disaster: 'critical',
  p1: 'critical',
  p2: 'high',
  p3: 'warning',
  p4: 'info',
  p5: 'debug',
};

export function severityRank(s: Severity): number {
  return RANK[s];
}

export function isSeverity(value: unknown): value is Severity {
  return typeof value === 'string' && (SEVERITIES as readonly string[]).includes(value);
}

/** Maps free-form severities ("error", "P1", "5") onto OpenRelay levels. */
export function parseSeverity(value: unknown, fallback: Severity = 'warning'): Severity {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'number' || /^\d+$/.test(String(value))) {
    // ntfy-style 1..5 (5 = max)
    const n = Number(value);
    if (n >= 5) return 'critical';
    if (n === 4) return 'high';
    if (n === 3) return 'warning';
    if (n === 2) return 'info';
    return 'debug';
  }
  return ALIASES[String(value).trim().toLowerCase()] ?? fallback;
}

export function maxSeverity(a: Severity, b: Severity): Severity {
  return RANK[a] >= RANK[b] ? a : b;
}

export function compareSeverity(a: Severity, b: Severity): number {
  return RANK[a] - RANK[b];
}

/** P1 (critical) .. P5 (debug). */
export function basePriority(s: Severity): number {
  return 5 - RANK[s];
}

const LABELS = {
  de: { debug: 'Debug', info: 'Info', warning: 'Warnung', high: 'Hoch', critical: 'Kritisch' },
  en: { debug: 'Debug', info: 'Info', warning: 'Warning', high: 'High', critical: 'Critical' },
} as const;

export function severityLabel(s: Severity, locale: 'de' | 'en' = 'de'): string {
  return LABELS[locale][s];
}

export const SEVERITY_EMOJI: Record<Severity, string> = {
  critical: '🔴',
  high: '🟠',
  warning: '🟡',
  info: '🔵',
  debug: '⚪',
};

export const SEVERITY_COLOR: Record<Severity, number> = {
  critical: 0xd93025,
  high: 0xf2711c,
  warning: 0xf2c94c,
  info: 0x2f80ed,
  debug: 0x9aa0a6,
};

export const RESOLVED_COLOR = 0x27ae60;
