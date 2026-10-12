import type { Alert, Incident, Severity, TimelineEntry, TimelineKind } from '../types.js';
import { newId } from '../util/ids.js';
import { DAY } from '../util/time.js';
import type { EngineContext } from './context.js';
import { inferRootCause, type CorrelationScore } from './correlation.js';
import { messages } from './i18n.js';
import type { Notifier } from './notifier.js';
import { basePriority, severityLabel, severityRank } from './severity.js';

export class IncidentError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

function maxOf(severities: Severity[]): Severity | null {
  let best: Severity | null = null;
  for (const s of severities) if (!best || severityRank(s) > severityRank(best)) best = s;
  return best;
}

function commonLabels(alerts: Alert[]): Record<string, string> {
  if (alerts.length === 0) return {};
  const [first, ...rest] = alerts;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(first.labels)) {
    if (rest.every((a) => a.labels[k] === v)) out[k] = v;
  }
  return out;
}

/** Incident lifecycle: creation, aggregation, acknowledgement, resolution, merging and splitting. */
export class IncidentService {
  constructor(
    private readonly ctx: EngineContext,
    private readonly notifier: Notifier,
  ) {}

  private get t() {
    return messages(this.ctx.settings().locale).timeline;
  }

  timeline(
    incidentId: string,
    kind: TimelineKind,
    message: string,
    actor: string | null = null,
    data: Record<string, unknown> | null = null,
  ): TimelineEntry {
    return this.ctx.store.addTimeline({ incidentId, ts: this.ctx.clock.now(), kind, message, actor, data });
  }

  priorityFor(severity: Severity, serviceCount: number): number {
    const wide = this.ctx.settings().priority.wideImpactServices;
    let p = basePriority(severity);
    if (wide > 0 && serviceCount >= wide) p -= 1;
    return Math.min(5, Math.max(1, p));
  }

  private emit(incident: Incident): void {
    this.ctx.bus.emit('incident', incident);
  }

  create(
    alert: Alert,
    now: number,
    opts: { storm?: boolean; stormCount?: number; related?: CorrelationScore[]; notify?: boolean } = {},
  ): Incident {
    const t = this.t;
    const incident: Incident = {
      id: newId('inc', now),
      number: this.ctx.store.nextIncidentNumber(),
      title: opts.storm ? messages(this.ctx.settings().locale).notify.stormTitle(1) : alert.title,
      status: 'open',
      severity: alert.severity,
      priority: this.priorityFor(alert.severity, alert.service ? 1 : 0),
      createdAt: now,
      updatedAt: now,
      lastActivityAt: now,
      acknowledgedAt: null,
      acknowledgedBy: null,
      resolvedAt: null,
      resolvedBy: null,
      rootAlertId: alert.id,
      rootFingerprint: alert.fingerprint,
      rootReason: null,
      services: alert.service ? [alert.service] : [],
      sources: [alert.source],
      labels: { ...alert.labels },
      correlationKey: alert.correlationKey,
      alertCount: 1,
      firingCount: alert.status === 'firing' ? 1 : 0,
      eventCount: alert.count,
      storm: !!opts.storm,
      recurrenceCount: 0,
      notifyState: 'pending',
      notifiedSeverity: null,
      notifiedChannels: [],
      escalationPolicyId: null,
      escalationStep: 0,
      escalationCycle: 0,
      escalationNextAt: null,
    };
    this.ctx.store.insertIncident(incident);
    alert.incidentId = incident.id;
    this.ctx.store.updateAlert(alert);

    if (opts.storm) {
      const settings = this.ctx.settings().storm;
      this.timeline(incident.id, 'created', t.createdStorm(opts.stormCount ?? settings.threshold, settings.windowSeconds), null, {
        alertId: alert.id,
      });
    } else {
      this.timeline(incident.id, 'created', t.created(alert.title, alert.source), null, { alertId: alert.id });
      this.linkRecurrence(incident, now);
    }

    for (const r of (opts.related ?? []).slice(0, 3)) {
      const related = this.ctx.store.getIncident(r.incidentId);
      if (!related) continue;
      this.ctx.store.addLink({
        incidentId: incident.id,
        relatedId: related.id,
        kind: 'related',
        score: r.score,
        reason: r.reasons.join(' · '),
        createdAt: now,
      });
      this.timeline(incident.id, 'linked', t.linkedRelated(related.number, Math.round(r.score * 100)), null, {
        relatedId: related.id,
        reasons: r.reasons,
      });
    }

    this.emit(incident);
    if (opts.notify !== false) this.notifier.evaluate(incident, 'opened');
    return incident;
  }

  /** Links the incident to earlier occurrences of the same root problem. */
  private linkRecurrence(incident: Incident, now: number): void {
    const lookback = this.ctx.settings().recurrence.lookbackDays;
    if (!lookback || !incident.rootFingerprint) return;
    const previous = this.ctx.store.previousOccurrences(incident.rootFingerprint, now - lookback * DAY, incident.id);
    if (previous.length === 0) return;
    const last = previous[0];
    incident.recurrenceCount = previous.length;
    this.ctx.store.updateIncident(incident);
    this.ctx.store.addLink({
      incidentId: incident.id,
      relatedId: last.id,
      kind: 'recurrence',
      score: null,
      reason: this.t.linkedRecurrence(last.number, now - last.createdAt, previous.length + 1),
      createdAt: now,
    });
    this.timeline(incident.id, 'linked', this.t.linkedRecurrence(last.number, now - last.createdAt, previous.length + 1), null, {
      relatedId: last.id,
      occurrences: previous.length + 1,
    });
  }

  attach(incident: Incident, alert: Alert, now: number, how: { score?: CorrelationScore; storm?: boolean; manual?: boolean } = {}): Incident {
    alert.incidentId = incident.id;
    this.ctx.store.updateAlert(alert);
    const t = this.t;
    if (how.storm) {
      // Storm incidents can collect thousands of alerts – keep the timeline readable.
      if (incident.alertCount < 50) this.timeline(incident.id, 'alert_added', t.alertAddedStorm(alert.title), null, { alertId: alert.id });
    } else if (how.manual) {
      this.timeline(incident.id, 'alert_added', t.alertAddedManual(alert.title), null, { alertId: alert.id });
    } else {
      const pct = Math.round((how.score?.score ?? 1) * 100);
      this.timeline(incident.id, 'alert_added', t.alertAdded(alert.title, pct), null, {
        alertId: alert.id,
        score: how.score?.score ?? null,
        reasons: how.score?.reasons ?? [],
        signals: how.score?.signals ?? [],
      });
    }
    return this.refresh(incident, now);
  }

  /** Recomputes aggregates (severity, priority, root cause, …) and triggers notifications for severity increases. */
  refresh(incident: Incident, now: number, opts: { notify?: boolean } = {}): Incident {
    const stats = this.ctx.store.incidentAlertStats(incident.id);
    const previous = incident.severity;
    const locale = this.ctx.settings().locale;

    incident.alertCount = stats.alertCount;
    incident.firingCount = stats.firingCount;
    incident.eventCount = stats.eventCount;
    incident.services = stats.services;
    incident.sources = stats.sources;
    incident.severity = maxOf(stats.firingSeverities) ?? maxOf(stats.allSeverities) ?? incident.severity;
    incident.priority = this.priorityFor(incident.severity, incident.services.length);

    const alerts = this.ctx.store.alertsByIncident(incident.id, 300);
    const root = inferRootCause(alerts, this.ctx.topology(), locale);
    const rootAlert = root ? alerts.find((a) => a.id === root.alertId) : undefined;
    if (rootAlert) {
      incident.rootAlertId = rootAlert.id;
      incident.rootFingerprint = rootAlert.fingerprint;
      incident.rootReason = root!.reason;
      if (!incident.storm) incident.title = rootAlert.title;
    }
    if (incident.storm) incident.title = messages(locale).notify.stormTitle(incident.alertCount);
    incident.labels = commonLabels(alerts);
    if (!incident.correlationKey) incident.correlationKey = alerts.find((a) => a.correlationKey)?.correlationKey ?? null;
    incident.updatedAt = now;
    incident.lastActivityAt = Math.max(incident.lastActivityAt, now);
    this.ctx.store.updateIncident(incident);

    if (incident.severity !== previous) {
      this.timeline(incident.id, 'severity_changed', this.t.severityChanged(severityLabel(previous, locale), severityLabel(incident.severity, locale)), null, {
        from: previous,
        to: incident.severity,
      });
    }
    this.emit(incident);

    if (opts.notify !== false && incident.status !== 'resolved' && severityRank(incident.severity) > severityRank(previous)) {
      if (incident.notifyState === 'notified') {
        if (severityRank(incident.severity) > severityRank(incident.notifiedSeverity ?? 'debug')) {
          this.notifier.evaluate(incident, 'severity');
        }
      } else if (incident.notifyState === 'none') {
        // A higher severity may match routes that did not match before.
        this.notifier.evaluate(incident, 'opened');
      }
    }
    return incident;
  }

  /** Records a firing/resolved transition; returns true when the alert just started flapping. */
  recordStateChange(alert: Alert, now: number): boolean {
    const f = this.ctx.settings().flapping;
    const windowStart = now - f.windowMinutes * 60_000;
    alert.stateChanges = [...alert.stateChanges.filter((ts) => ts >= windowStart), now].slice(-100);
    if (f.enabled && !alert.flapping && alert.stateChanges.length >= f.threshold) {
      alert.flapping = true;
      return true;
    }
    return false;
  }

  noteFlapping(alert: Alert): void {
    if (!alert.incidentId) return;
    const f = this.ctx.settings().flapping;
    this.timeline(alert.incidentId, 'flapping', this.t.flapping(alert.title, alert.stateChanges.length, f.windowMinutes), null, {
      alertId: alert.id,
    });
  }

  /** Resolves an alert and, when nothing fires anymore, its incident. */
  resolveAlert(alert: Alert, now: number, by: string): void {
    if (alert.status === 'resolved') return;
    alert.status = 'resolved';
    alert.resolvedAt = now;
    const startedFlapping = by === 'event' ? this.recordStateChange(alert, now) : false;
    this.ctx.store.updateAlert(alert);
    this.ctx.bus.emit('alert', alert);
    if (startedFlapping) this.noteFlapping(alert);

    const incident = alert.incidentId ? this.ctx.store.getIncident(alert.incidentId) : undefined;
    if (!incident || incident.status === 'resolved') return;
    if (!incident.storm || incident.alertCount < 50) {
      this.timeline(incident.id, 'alert_resolved', this.t.alertResolved(alert.title, by), null, { alertId: alert.id });
    }
    this.refresh(incident, now, { notify: false });
    this.resolveIfDone(incident, now);
  }

  /** Auto-resolves an incident without firing alerts, unless a flapping alert still needs to settle. */
  resolveIfDone(incident: Incident, now: number): void {
    if (incident.status === 'resolved' || incident.firingCount > 0 || incident.alertCount === 0) return;
    if (this.notifier.hasFlappingAlert(incident)) {
      const recent = this.ctx.store.timeline(incident.id, 5);
      if (!recent.some((e) => e.message === this.t.waitingForStable())) {
        this.timeline(incident.id, 'flapping', this.t.waitingForStable());
      }
      return;
    }
    this.resolve(incident, 'auto', now);
  }

  resolve(incident: Incident, actor: string, now: number, note?: string | null): Incident {
    if (incident.status === 'resolved') return incident;
    if (actor !== 'auto') {
      for (const alert of this.ctx.store.alertsByIncident(incident.id, 100_000)) {
        if (alert.status === 'firing') {
          alert.status = 'resolved';
          alert.resolvedAt = now;
          this.ctx.store.updateAlert(alert);
        }
      }
    }
    incident.status = 'resolved';
    incident.resolvedAt = now;
    incident.resolvedBy = actor;
    incident.escalationNextAt = null;
    incident.firingCount = 0;
    incident.updatedAt = now;
    this.ctx.store.updateIncident(incident);
    this.timeline(incident.id, 'resolved', actor === 'auto' ? this.t.resolvedAuto() : this.t.resolved(actor, note), actor === 'auto' ? null : actor, note ? { note } : null);
    this.emit(incident);
    this.notifier.evaluate(incident, 'resolved');
    return incident;
  }

  acknowledge(incident: Incident, actor: string, now: number): Incident {
    if (incident.status !== 'open') return incident;
    incident.status = 'acknowledged';
    incident.acknowledgedAt = now;
    incident.acknowledgedBy = actor;
    incident.escalationNextAt = null;
    incident.updatedAt = now;
    this.ctx.store.updateIncident(incident);
    this.timeline(incident.id, 'acknowledged', this.t.acknowledged(actor), actor);
    this.emit(incident);
    return incident;
  }

  reopen(incident: Incident, now: number, actor?: string): Incident {
    if (incident.status !== 'resolved') return incident;
    incident.status = 'open';
    incident.resolvedAt = null;
    incident.resolvedBy = null;
    incident.acknowledgedAt = null;
    incident.acknowledgedBy = null;
    incident.escalationPolicyId = null;
    incident.escalationStep = 0;
    incident.escalationCycle = 0;
    incident.escalationNextAt = null;
    incident.updatedAt = now;
    incident.lastActivityAt = now;
    this.ctx.store.updateIncident(incident);
    this.timeline(incident.id, 'reopened', this.t.reopened(actor), actor ?? null);
    this.emit(incident);
    this.notifier.evaluate(incident, 'reopened');
    return incident;
  }

  comment(incident: Incident, text: string, actor: string): TimelineEntry {
    const entry = this.timeline(incident.id, 'comment', text, actor);
    incident.updatedAt = this.ctx.clock.now();
    this.ctx.store.updateIncident(incident);
    this.emit(incident);
    return entry;
  }

  /**
   * Moves all alerts of `source` into `target`. Manual merges are remembered ("learned"), so the same
   * problems are grouped automatically next time; automatic merges (common root cause) are not.
   */
  merge(source: Incident, target: Incident, actor: string, now: number, opts: { cause?: string } = {}): Incident {
    if (source.id === target.id) throw new IncidentError('Ein Vorfall kann nicht mit sich selbst zusammengeführt werden');
    const sourceAlerts = this.ctx.store.alertsByIncident(source.id, 100_000);
    const targetAlerts = this.ctx.store.alertsByIncident(target.id, 200);
    const auto = opts.cause !== undefined;

    if (!auto) {
      const sourceFps = [...new Set(sourceAlerts.map((a) => a.fingerprint))].slice(0, 25);
      const targetFps = [...new Set(targetAlerts.map((a) => a.fingerprint))].slice(0, 25);
      for (const a of sourceFps) for (const b of targetFps) if (a !== b) this.ctx.store.setLearned(a, b, 1, `merge:${actor}`, now);
      this.ctx.reloadLearned();
    }

    for (const alert of sourceAlerts) {
      alert.incidentId = target.id;
      this.ctx.store.updateAlert(alert);
    }

    source.status = 'resolved';
    source.resolvedAt = now;
    source.resolvedBy = `merge:#${target.number}`;
    source.escalationNextAt = null;
    source.alertCount = 0;
    source.firingCount = 0;
    source.updatedAt = now;
    this.ctx.store.updateIncident(source);
    const actorName = auto ? null : actor;
    this.timeline(source.id, 'merged', auto ? this.t.autoMergedInto(target.number, opts.cause!) : this.t.mergedInto(target.number, actor), actorName, {
      targetId: target.id,
    });
    this.ctx.store.addLink({ incidentId: target.id, relatedId: source.id, kind: 'merged', score: null, reason: opts.cause ?? null, createdAt: now });
    this.timeline(target.id, 'merged', auto ? this.t.autoMerged(source.number, opts.cause!) : this.t.mergedFrom(source.number, sourceAlerts.length, actor), actorName, {
      sourceId: source.id,
    });
    this.emit(source);

    this.refresh(target, now);
    if (target.status === 'resolved' && target.firingCount > 0) this.reopen(target, now, actor);
    return target;
  }

  /** Splits an alert into its own incident and remembers that it does not belong to the others. */
  detach(alert: Alert, actor: string, now: number): Incident {
    const old = alert.incidentId ? this.ctx.store.getIncident(alert.incidentId) : undefined;
    if (!old) throw new IncidentError('Alarm gehört zu keinem Vorfall', 404);
    const remaining = this.ctx.store.alertsByIncident(old.id, 1000).filter((a) => a.id !== alert.id);
    if (remaining.length === 0) throw new IncidentError('Der Vorfall enthält nur diesen Alarm');

    for (const other of remaining.slice(0, 50)) {
      if (other.fingerprint !== alert.fingerprint) this.ctx.store.setLearned(alert.fingerprint, other.fingerprint, -1, `detach:${actor}`, now);
    }
    this.ctx.reloadLearned();

    alert.incidentId = null;
    this.ctx.store.updateAlert(alert);
    const created = this.create(alert, now, { notify: false });
    this.timeline(created.id, 'alert_detached', this.t.alertDetachedNew(alert.title, old.number), actor, { fromId: old.id });
    this.timeline(old.id, 'alert_detached', this.t.alertDetached(alert.title, created.number), actor, { toId: created.id, alertId: alert.id });
    this.refresh(created, now, { notify: false });
    if (alert.status === 'resolved') this.resolve(created, actor, now);
    else this.notifier.evaluate(created, 'opened');

    this.refresh(old, now, { notify: false });
    this.resolveIfDone(old, now);
    return created;
  }
}
