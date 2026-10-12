import type { Alert, EventAction, EventInput, Incident, IngestResult, NormalizedEvent, StoredEvent } from '../types.js';
import { newId } from '../util/ids.js';
import { MINUTE, SECOND } from '../util/time.js';
import type { EngineContext } from './context.js';
import { rankCandidates, type CorrelationScore } from './correlation.js';
import { computeFingerprint } from './fingerprint.js';
import { messages } from './i18n.js';
import type { IncidentService } from './incidents.js';
import { matchesAll } from './matcher.js';
import { alertMatchContext, eventMatchContext } from './notifier.js';
import { normalizeEvent, validateEventInput } from './schema.js';
import { maxSeverity, severityLabel, severityRank } from './severity.js';

export interface IngestMeta {
  /** Source for events that don't declare one (e.g. the API key's default source). */
  defaultSource?: string | null;
}

/** Event → Alert (dedup) → Incident (correlation). */
export class Pipeline {
  constructor(
    private readonly ctx: EngineContext,
    private readonly incidents: IncidentService,
  ) {}

  /** Validates and processes events. Throws `EventValidationError` before anything is stored. */
  async ingest(inputs: EventInput[], meta: IngestMeta = {}): Promise<IngestResult[]> {
    const validated = inputs.map((input) => validateEventInput(input));
    const results: IngestResult[] = [];
    for (const input of validated) {
      const now = this.ctx.clock.now();
      let event: NormalizedEvent | null = normalizeEvent(input, { source: meta.defaultSource }, now);
      event = this.applyEventRules(event);
      for (const processor of this.ctx.registry.processors) {
        if (!event) break;
        try {
          event = await processor.process(event, { logger: this.ctx.logger });
        } catch (err) {
          this.ctx.logger.warn({ err: (err as Error).message, processor: processor.name }, 'Prozessor-Plugin fehlgeschlagen');
        }
      }
      if (!event) {
        results.push({ eventId: null, alertId: null, incidentId: null, action: 'dropped' });
        continue;
      }
      if (!event.fingerprint) event.fingerprint = computeFingerprint(event);
      const ready = event;
      results.push(this.ctx.store.tx(() => this.process(ready, this.ctx.clock.now())));
    }
    this.ctx.wake();
    return results;
  }

  applyEventRules(event: NormalizedEvent): NormalizedEvent | null {
    const rules = this.ctx.settings().eventRules;
    if (rules.length === 0) return event;
    let current = event;
    for (const rule of rules) {
      if (!matchesAll(rule.matchers, eventMatchContext(current))) continue;
      if (rule.drop) return null;
      if (rule.set) {
        current = {
          ...current,
          severity: rule.set.severity ?? current.severity,
          service: rule.set.service ?? current.service,
          host: rule.set.host ?? current.host,
          correlationKey: rule.set.correlationKey ?? current.correlationKey,
          labels: { ...current.labels, ...(rule.set.labels ?? {}) },
        };
      }
    }
    return current;
  }

  private storeEvent(event: NormalizedEvent, now: number, alert: Alert | null, action: EventAction): StoredEvent {
    const stored: StoredEvent = {
      ...event,
      id: newId('evt', now),
      receivedAt: now,
      alertId: alert?.id ?? null,
      incidentId: alert?.incidentId ?? null,
      action,
    };
    this.ctx.store.insertEvent(stored);
    this.ctx.bus.emit('event', stored);
    return stored;
  }

  private result(stored: StoredEvent): IngestResult {
    return { eventId: stored.id, alertId: stored.alertId, incidentId: stored.incidentId, action: stored.action };
  }

  /** Synchronous core, runs inside a transaction. */
  process(event: NormalizedEvent, now: number): IngestResult {
    const settings = this.ctx.settings();
    const reopenWindow = settings.dedup.reopenWindowMinutes * MINUTE;
    let alert = this.ctx.store.latestAlertByFingerprint(event.fingerprint);
    if (alert && alert.status === 'resolved' && (alert.resolvedAt ?? 0) < now - reopenWindow) alert = undefined;

    // ---- resolve events
    if (event.status === 'resolved') {
      if (!alert || alert.status === 'resolved') return this.result(this.storeEvent(event, now, alert ?? null, 'ignored'));
      alert.lastSeen = now;
      if (event.message) alert.message = event.message;
      this.incidents.resolveAlert(alert, now, 'event');
      return this.result(this.storeEvent(event, now, alert, 'resolved'));
    }

    // ---- duplicate of a firing alert
    if (alert && alert.status === 'firing') {
      alert.count += 1;
      alert.lastSeen = now;
      alert.message = event.message ?? alert.message;
      alert.severity = maxSeverity(alert.severity, event.severity);
      alert.url = event.url ?? alert.url;
      alert.labels = { ...alert.labels, ...event.labels };
      if (event.ttl !== null) alert.ttl = event.ttl;
      this.ctx.store.updateAlert(alert);
      const stored = this.storeEvent(event, now, alert, 'deduplicated');
      this.applyVolumeRules(alert, now);
      const incident = alert.incidentId ? this.ctx.store.getIncident(alert.incidentId) : undefined;
      if (incident && incident.status !== 'resolved') this.incidents.refresh(incident, now);
      else this.correlate(alert, now);
      this.ctx.bus.emit('alert', alert);
      return this.result({ ...stored, incidentId: alert.incidentId });
    }

    // ---- recently resolved alert fires again
    if (alert && alert.status === 'resolved') {
      alert.status = 'firing';
      alert.resolvedAt = null;
      alert.count += 1;
      alert.lastSeen = now;
      alert.severity = event.severity;
      alert.message = event.message ?? alert.message;
      alert.labels = { ...alert.labels, ...event.labels };
      if (event.ttl !== null) alert.ttl = event.ttl;
      const startedFlapping = this.incidents.recordStateChange(alert, now);
      this.ctx.store.updateAlert(alert);
      if (startedFlapping) this.incidents.noteFlapping(alert);

      const incident = alert.incidentId ? this.ctx.store.getIncident(alert.incidentId) : undefined;
      const t = messages(settings.locale).timeline;
      if (incident && incident.status !== 'resolved') {
        if (!incident.storm) this.incidents.timeline(incident.id, 'alert_reopened', t.alertReopened(alert.title), null, { alertId: alert.id });
        this.incidents.refresh(incident, now);
      } else if (
        incident &&
        (incident.resolvedAt ?? 0) >= now - reopenWindow &&
        !(incident.resolvedBy ?? '').startsWith('merge')
      ) {
        this.incidents.timeline(incident.id, 'alert_reopened', t.alertReopened(alert.title), null, { alertId: alert.id });
        this.incidents.refresh(incident, now, { notify: false });
        this.incidents.reopen(incident, now);
      } else {
        alert.incidentId = null;
        this.ctx.store.updateAlert(alert);
        this.correlate(alert, now);
      }
      this.ctx.bus.emit('alert', alert);
      return this.result(this.storeEvent(event, now, alert, 'reopened'));
    }

    // ---- new alert
    const created: Alert = {
      id: newId('alr', now),
      fingerprint: event.fingerprint,
      source: event.source,
      type: event.type,
      title: event.title,
      message: event.message,
      severity: event.severity,
      baseSeverity: event.severity,
      status: 'firing',
      service: event.service,
      host: event.host,
      correlationKey: event.correlationKey,
      labels: event.labels,
      url: event.url,
      firstSeen: now,
      lastSeen: now,
      resolvedAt: null,
      count: 1,
      incidentId: null,
      ttl: event.ttl,
      flapping: false,
      stateChanges: [],
    };
    this.ctx.store.insertAlert(created);
    this.correlate(created, now);
    this.ctx.bus.emit('alert', created);
    return this.result(this.storeEvent(event, now, created, 'created'));
  }

  /** "500 errors in 5 minutes" → raise severity. */
  private applyVolumeRules(alert: Alert, now: number): void {
    const settings = this.ctx.settings();
    for (const rule of settings.volumeRules) {
      if (severityRank(alert.severity) >= severityRank(rule.raiseTo)) continue;
      if (!matchesAll(rule.matchers, alertMatchContext(alert))) continue;
      const count = this.ctx.store.countAlertEventsSince(alert.id, now - rule.windowMinutes * MINUTE);
      if (count < rule.count) continue;
      alert.severity = rule.raiseTo;
      this.ctx.store.updateAlert(alert);
      if (alert.incidentId) {
        const t = messages(settings.locale).timeline;
        this.incidents.timeline(alert.incidentId, 'severity_changed', t.volumeRaised(alert.title, count, rule.windowMinutes, severityLabel(rule.raiseTo, settings.locale)), null, {
          alertId: alert.id,
          rule: rule.name,
        });
      }
    }
  }

  /** Attaches a new alert to the best matching open incident or opens a new one. */
  correlate(alert: Alert, now: number): Incident {
    const settings = this.ctx.settings();
    const c = settings.correlation;
    let related: CorrelationScore[] = [];

    if (c.enabled) {
      if (alert.correlationKey) {
        const byKey = this.ctx.store.openIncidentByCorrelationKey(alert.correlationKey);
        if (byKey) {
          const reason = messages(settings.locale).reason.key(alert.correlationKey);
          return this.incidents.attach(byKey, alert, now, {
            score: { incidentId: byKey.id, score: 1, signals: [{ kind: 'key', weight: 1, reason }], reasons: [reason], blocked: false },
          });
        }
      }

      const candidates = this.ctx.store
        .correlationCandidates(now - c.windowMinutes * MINUTE)
        .filter((i) => !i.storm && i.id !== alert.incidentId);
      if (candidates.length > 0) {
        const byId = new Map(candidates.map((i) => [i.id, i]));
        const ranked = rankCandidates(
          alert,
          candidates.map((i) => ({
            incidentId: i.id,
            correlationKey: i.correlationKey,
            lastActivityAt: i.lastActivityAt,
            alerts: this.ctx.store.recentAlertsByIncident(i.id, 50),
          })),
          {
            now,
            settings: c,
            topology: this.ctx.topology(),
            learned: (a, b) => this.ctx.learned(a, b),
            locale: settings.locale,
          },
        );
        const best = ranked[0];
        if (best && !best.blocked && best.score >= c.threshold) {
          const target = this.incidents.attach(byId.get(best.incidentId)!, alert, now, { score: best });
          // The new alert is the upstream cause of several open incidents → they are one problem.
          if (alert.service && best.signals.some((s) => s.kind === 'topology' && s.upstream)) {
            for (const other of ranked.slice(1)) {
              if (other.blocked || other.score < c.threshold) continue;
              if (!other.signals.some((s) => s.kind === 'topology' && s.upstream)) continue;
              const incident = this.ctx.store.getIncident(other.incidentId);
              if (incident && incident.status !== 'resolved') {
                this.incidents.merge(incident, this.ctx.store.getIncident(target.id)!, 'auto', now, { cause: alert.service });
              }
            }
          }
          return this.ctx.store.getIncident(target.id)!;
        }
        related = ranked.filter((r) => !r.blocked && r.score >= c.relatedThreshold);
      }
    }

    if (settings.storm.enabled) {
      const recent = this.ctx.store.countAlertsCreatedSince(now - settings.storm.windowSeconds * SECOND);
      if (recent >= settings.storm.threshold) {
        const storm = this.ctx.store.openStormIncident();
        if (storm) return this.incidents.attach(storm, alert, now, { storm: true });
        return this.incidents.create(alert, now, { storm: true, stormCount: recent });
      }
    }

    return this.incidents.create(alert, now, { related });
  }
}
