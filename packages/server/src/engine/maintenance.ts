import { DAY, HOUR, MINUTE } from '../util/time.js';
import type { EngineContext } from './context.js';
import { messages } from './i18n.js';
import type { IncidentService } from './incidents.js';
import type { Notifier } from './notifier.js';

/** Periodic housekeeping: timeouts, flapping recovery, expired silences, retention. */
export class Maintenance {
  private lastPrune = 0;

  constructor(
    private readonly ctx: EngineContext,
    private readonly incidents: IncidentService,
    private readonly notifier: Notifier,
  ) {}

  run(now: number): void {
    this.expireAlerts(now);
    this.recoverFlapping(now);
    this.releaseSilenced(now);
    if (now - this.lastPrune >= HOUR) {
      this.prune(now);
      this.lastPrune = now;
    }
  }

  /** Alerts without resolve events time out after their TTL / the global auto-resolve setting. */
  expireAlerts(now: number): number {
    const timeout = this.ctx.settings().dedup.autoResolveMinutes * MINUTE;
    const expired = this.ctx.store.expiredAlerts(now, timeout);
    for (const alert of expired) {
      this.ctx.store.tx(() => this.incidents.resolveAlert(alert, now, 'timeout'));
    }
    return expired.length;
  }

  recoverFlapping(now: number): void {
    const f = this.ctx.settings().flapping;
    const t = messages(this.ctx.settings().locale).timeline;
    for (const alert of this.ctx.store.flappingAlerts()) {
      const last = alert.stateChanges[alert.stateChanges.length - 1] ?? 0;
      if (f.enabled && last >= now - f.windowMinutes * MINUTE) continue;
      this.ctx.store.tx(() => {
        alert.flapping = false;
        alert.stateChanges = [];
        this.ctx.store.updateAlert(alert);
        if (!alert.incidentId) return;
        this.incidents.timeline(alert.incidentId, 'flapping', t.flappingCleared(alert.title), null, { alertId: alert.id });
        const incident = this.ctx.store.getIncident(alert.incidentId);
        if (incident) this.incidents.resolveIfDone(incident, now);
      });
    }
    // Safety net for incidents that ended up without firing alerts.
    for (const incident of this.ctx.store.openIncidentsWithResolvedAlerts()) {
      this.ctx.store.tx(() => this.incidents.resolveIfDone(incident, now));
    }
  }

  /** Incidents that were muted by a silence get their notification once the silence is over. */
  releaseSilenced(now: number): void {
    for (const incident of this.ctx.store.suppressedOpenIncidents()) {
      if (this.notifier.activeSilence(this.notifier.matchContext(incident), now)) continue;
      this.ctx.store.tx(() => {
        incident.notifyState = 'pending';
        this.notifier.evaluate(incident, 'opened');
      });
    }
  }

  prune(now: number): void {
    const r = this.ctx.settings().retention;
    const events = this.ctx.store.pruneEvents(now - r.eventsDays * DAY);
    const incidents = this.ctx.store.pruneResolvedIncidents(now - r.resolvedIncidentsDays * DAY);
    const deliveries = this.ctx.store.pruneDeliveries(now - r.deliveriesDays * DAY);
    const silences = this.ctx.store.pruneSilences(now - 30 * DAY);
    if (events + incidents + deliveries + silences > 0) {
      this.ctx.logger.info({ events, incidents, deliveries, silences }, 'Aufbewahrung: alte Daten entfernt');
    }
  }
}
