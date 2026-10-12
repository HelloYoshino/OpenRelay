import type { EngineSettings, Severity } from '../types.js';
import { jaccard, tokenize } from './fingerprint.js';
import { messages } from './i18n.js';
import type { Topology } from './topology.js';

export interface CorrelationAlert {
  id?: string;
  fingerprint: string;
  source: string;
  service: string | null;
  host: string | null;
  title: string;
  labels: Record<string, string>;
  correlationKey: string | null;
}

export interface CorrelationCandidate {
  incidentId: string;
  correlationKey: string | null;
  lastActivityAt: number;
  alerts: CorrelationAlert[];
}

export type SignalKind = 'key' | 'learned' | 'topology' | 'service' | 'host' | 'label' | 'similarity' | 'source';

export interface CorrelationSignal {
  kind: SignalKind;
  weight: number;
  reason: string;
  /** Topology only: the new alert is the upstream dependency (probable cause) of the incident's alerts. */
  upstream?: boolean;
}

export interface CorrelationScore {
  incidentId: string;
  score: number;
  signals: CorrelationSignal[];
  reasons: string[];
  /** A learned "do not group" rule matched. */
  blocked: boolean;
}

export interface ScoreOptions {
  now: number;
  settings: EngineSettings['correlation'];
  topology: Topology;
  /** +1 = learned link, -1 = learned separation, 0 = unknown. */
  learned: (fpA: string, fpB: string) => number;
  locale: 'de' | 'en';
}

const tokenCache = new Map<string, Set<string>>();

function tokensOf(title: string): Set<string> {
  let tokens = tokenCache.get(title);
  if (!tokens) {
    tokens = tokenize(title);
    if (tokenCache.size > 10_000) tokenCache.clear();
    tokenCache.set(title, tokens);
  }
  return tokens;
}

/** Combines independent evidence: 1 - Π(1 - wᵢ). */
export function noisyOr(weights: number[]): number {
  let rest = 1;
  for (const w of weights) rest *= 1 - Math.min(1, Math.max(0, w));
  return 1 - rest;
}

/** Evidence decays slowly in the second half of the correlation window (down to 60 %). */
export function temporalFactor(dtMs: number, windowMs: number): number {
  if (windowMs <= 0) return 1;
  const half = windowMs / 2;
  if (dtMs <= half) return 1;
  const progress = Math.min(1, (dtMs - half) / half);
  return 1 - 0.4 * progress;
}

/**
 * Scores how likely `alert` belongs to the open incident `candidate`.
 * Every signal is explained, so the dashboard can show *why* alerts were grouped.
 */
export function scoreCandidate(alert: CorrelationAlert, candidate: CorrelationCandidate, opts: ScoreOptions): CorrelationScore {
  const t = messages(opts.locale).reason;
  const w = opts.settings.weights;
  const signals: CorrelationSignal[] = [];

  // 1. Explicit correlation key: definitive.
  const key = alert.correlationKey;
  if (key && (candidate.correlationKey === key || candidate.alerts.some((a) => a.correlationKey === key))) {
    return {
      incidentId: candidate.incidentId,
      score: 1,
      signals: [{ kind: 'key', weight: 1, reason: t.key(key) }],
      reasons: [t.key(key)],
      blocked: false,
    };
  }

  let learnedLink = false;
  let blocked = false;
  let bestTopology: { weight: number; reason: string; upstream: boolean } | null = null;
  let sameService: string | null = null;
  let sameHost: string | null = null;
  let sameSource: string | null = null;
  let bestSimilarity = 0;
  const labelMatches = new Map<string, string>();
  const alertTokens = tokensOf(alert.title);

  for (const other of candidate.alerts) {
    const learned = opts.learned(alert.fingerprint, other.fingerprint);
    if (learned < 0) blocked = true;
    if (learned > 0) learnedLink = true;

    if (alert.service && other.service) {
      if (alert.service.toLowerCase() === other.service.toLowerCase()) {
        sameService = alert.service;
      } else {
        const rel = opts.topology.relation(alert.service, other.service);
        if (rel) {
          const weight = w.topology * (rel.distance === 1 ? 1 : rel.distance === 2 ? 0.85 : 0.7);
          if (!bestTopology || weight > bestTopology.weight) {
            bestTopology = {
              weight,
              reason: t.topology(rel.downstream, rel.upstream, rel.distance),
              upstream: rel.upstream.toLowerCase() === alert.service.toLowerCase(),
            };
          }
        } else {
          // Siblings sharing a dependency are only a weak hint on their own.
          const common = opts.topology.commonDependency(alert.service, other.service);
          const weight = w.topology * 0.5;
          if (common && (!bestTopology || weight > bestTopology.weight)) {
            bestTopology = { weight, reason: t.sharedDependency(alert.service, other.service, common), upstream: false };
          }
        }
      }
    }
    if (alert.host && other.host && alert.host.toLowerCase() === other.host.toLowerCase()) sameHost = alert.host;
    if (alert.source === other.source) sameSource = alert.source;

    for (const label of opts.settings.groupByLabels) {
      const value = alert.labels[label];
      if (value !== undefined && value !== '' && other.labels[label] === value) labelMatches.set(label, value);
    }

    if (bestSimilarity < 1) {
      bestSimilarity = Math.max(bestSimilarity, jaccard(alertTokens, tokensOf(other.title)));
    }
  }

  if (blocked) {
    return { incidentId: candidate.incidentId, score: 0, signals: [], reasons: [], blocked: true };
  }

  if (learnedLink) signals.push({ kind: 'learned', weight: w.learned, reason: t.learned() });
  if (bestTopology) {
    signals.push({ kind: 'topology', weight: bestTopology.weight, reason: bestTopology.reason, upstream: bestTopology.upstream });
  }
  if (sameService) signals.push({ kind: 'service', weight: w.service, reason: t.service(sameService) });
  if (sameHost) signals.push({ kind: 'host', weight: w.host, reason: t.host(sameHost) });
  for (const [label, value] of labelMatches) {
    signals.push({ kind: 'label', weight: w.label, reason: t.label(label, value) });
  }
  if (bestSimilarity >= 0.5) {
    signals.push({
      kind: 'similarity',
      weight: w.similarity * bestSimilarity,
      reason: t.similarity(Math.round(bestSimilarity * 100)),
    });
  }
  if (sameSource) signals.push({ kind: 'source', weight: w.source, reason: t.source(sameSource) });

  const raw = noisyOr(signals.map((s) => s.weight));
  const dt = Math.max(0, opts.now - candidate.lastActivityAt);
  const factor = temporalFactor(dt, opts.settings.windowMinutes * 60_000);
  const score = Math.round(raw * factor * 1000) / 1000;
  const reasons = signals.map((s) => s.reason);
  if (signals.length > 0) reasons.push(t.proximity(dt));

  return { incidentId: candidate.incidentId, score, signals, reasons, blocked: false };
}

/** Picks the best candidate; ties go to the most recently active incident. */
export function rankCandidates(
  alert: CorrelationAlert,
  candidates: CorrelationCandidate[],
  opts: ScoreOptions,
): CorrelationScore[] {
  const byActivity = new Map(candidates.map((c) => [c.incidentId, c.lastActivityAt]));
  return candidates
    .map((c) => scoreCandidate(alert, c, opts))
    .sort((a, b) => b.score - a.score || byActivity.get(b.incidentId)! - byActivity.get(a.incidentId)!);
}

export interface RootCauseAlert {
  id: string;
  service: string | null;
  firstSeen: number;
  status: 'firing' | 'resolved';
  severity: Severity;
}

/**
 * Probable root cause of an incident: the service most other affected services depend on;
 * without topology information the earliest signal wins.
 */
export function inferRootCause(
  alerts: RootCauseAlert[],
  topology: Topology,
  locale: 'de' | 'en',
): { alertId: string; reason: string | null } | null {
  if (alerts.length === 0) return null;
  const t = messages(locale).root;
  const byTime = [...alerts].sort((a, b) => a.firstSeen - b.firstSeen);

  if (topology.size > 0) {
    const services = [...new Set(alerts.map((a) => a.service).filter((s): s is string => !!s))];
    let best: { service: string; dependents: string[] } | null = null;
    for (const service of services) {
      const dependents = topology.dependentsAmong(service, services);
      if (dependents.length > 0 && (!best || dependents.length > best.dependents.length)) {
        best = { service, dependents };
      }
    }
    if (best) {
      const ofService = byTime.filter((a) => a.service === best!.service);
      const root = ofService.find((a) => a.status === 'firing') ?? ofService[0];
      return { alertId: root.id, reason: t.dependency(best.service, best.dependents) };
    }
  }

  return { alertId: byTime[0].id, reason: alerts.length > 1 ? t.first() : null };
}
