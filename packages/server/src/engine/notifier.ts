import type { Alert, Channel, Incident, NormalizedEvent, NotificationKind, QuietHours, Route, Silence } from '../types.js';
import { localMinutes, MINUTE, parseClock } from '../util/time.js';
import type { EngineContext } from './context.js';
import { messages } from './i18n.js';
import { explainMatch, flattenLabels, matchesAll, type MatchContext } from './matcher.js';
import { buildIncidentMessage } from './message.js';
import { severityRank } from './severity.js';
import type { Severity } from '../types.js';

export type NotifyTrigger = 'opened' | 'reopened' | 'severity' | 'resolved';

export interface DeliveryDecision {
  mode: 'immediate' | 'digest';
  dueAt: number | null;
  intervalMinutes: number;
  quietHours: boolean;
}

export function eventMatchContext(ev: NormalizedEvent): MatchContext {
  return {
    severity: ev.severity,
    status: ev.status,
    source: ev.source,
    sources: [ev.source],
    type: ev.type,
    title: ev.title,
    message: ev.message,
    service: ev.service,
    services: ev.service ? [ev.service] : [],
    host: ev.host,
    correlationKey: ev.correlationKey,
    fingerprint: ev.fingerprint,
    ...flattenLabels(ev.labels),
  };
}

export function alertMatchContext(a: Alert): MatchContext {
  return {
    severity: a.severity,
    status: a.status,
    source: a.source,
    sources: [a.source],
    type: a.type,
    title: a.title,
    message: a.message,
    service: a.service,
    services: a.service ? [a.service] : [],
    host: a.host,
    correlationKey: a.correlationKey,
    fingerprint: a.fingerprint,
    ...flattenLabels(a.labels),
  };
}

/** Whether `ts` lies within the quiet hours, and when they end. */
export function quietHoursState(q: QuietHours, ts: number): { active: boolean; endsAt: number } {
  const { minutes } = localMinutes(ts, q.timezone || undefined);
  const start = parseClock(q.start);
  const end = parseClock(q.end);
  const active = start === end ? false : start < end ? minutes >= start && minutes < end : minutes >= start || minutes < end;
  const untilEnd = (end - minutes + 1440) % 1440 || 1440;
  const endsAt = Math.floor(ts / MINUTE) * MINUTE + untilEnd * MINUTE;
  return { active, endsAt };
}

/** Decides which incidents notify whom, when and how (immediately, as digest, via escalation). */
export class Notifier {
  constructor(private readonly ctx: EngineContext) {}

  private get t() {
    return messages(this.ctx.settings().locale).timeline;
  }

  matchContext(incident: Incident, rootAlert?: Alert | null): MatchContext {
    const root = rootAlert !== undefined ? rootAlert : incident.rootAlertId ? this.ctx.store.getAlert(incident.rootAlertId) ?? null : null;
    return {
      ...(root ? alertMatchContext(root) : {}),
      ...flattenLabels(incident.labels),
      severity: incident.severity,
      priority: incident.priority,
      status: incident.status,
      title: incident.title,
      source: root?.source ?? incident.sources[0] ?? null,
      sources: incident.sources,
      service: root?.service ?? incident.services[0] ?? null,
      services: incident.services,
      correlationKey: incident.correlationKey ?? root?.correlationKey ?? null,
      storm: incident.storm ? 'true' : 'false',
    };
  }

  activeSilence(context: MatchContext, now: number): Silence | null {
    for (const silence of this.ctx.store.listSilences(now)) {
      if (silence.matchers.length > 0 && matchesAll(silence.matchers, context)) return silence;
    }
    return null;
  }

  matchingRoutes(context: MatchContext): Route[] {
    const out: Route[] = [];
    for (const route of this.ctx.store.listRoutes()) {
      if (!route.enabled) continue;
      if (!matchesAll(route.matchers, context)) continue;
      out.push(route);
      if (route.stop) break;
    }
    return out;
  }

  decide(route: Route, severity: Severity, now: number): DeliveryDecision {
    const s = this.ctx.settings().notifications;
    const intervalMinutes = route.digestMinutes ?? s.digestMinutes;
    let mode: 'immediate' | 'digest' =
      route.delivery === 'immediate'
        ? 'immediate'
        : route.delivery === 'digest'
          ? 'digest'
          : severityRank(severity) >= severityRank(s.immediateSeverity)
            ? 'immediate'
            : 'digest';
    if (mode === 'digest' && severity === 'critical' && s.criticalBypassDigest) mode = 'immediate';

    if (route.quietHours) {
      const q = quietHoursState(route.quietHours, now);
      const bypass = severityRank(severity) >= severityRank(route.quietHours.bypassSeverity ?? 'critical');
      if (q.active && !bypass) return { mode: 'digest', dueAt: q.endsAt, intervalMinutes, quietHours: true };
    }
    return { mode, dueAt: mode === 'digest' ? now + intervalMinutes * MINUTE : null, intervalMinutes, quietHours: false };
  }

  /** Dry run used by the routing simulator. */
  simulate(context: MatchContext, severity: Severity, now: number) {
    const silencedBy = this.activeSilence(context, now);
    let stopped = false;
    const routes = this.ctx.store.listRoutes().map((route) => {
      const conditions = explainMatch(route.matchers, context);
      const matched = !stopped && route.enabled && conditions.every((c) => c.matched);
      const decision = matched ? this.decide(route, severity, now) : null;
      if (matched && route.stop) stopped = true;
      return {
        routeId: route.id,
        name: route.name,
        enabled: route.enabled,
        matched,
        mode: decision?.mode ?? null,
        quietHours: decision?.quietHours ?? false,
        channels: route.channels,
        escalationPolicyId: route.escalationPolicyId,
        conditions,
      };
    });
    return { context, silencedBy, routes };
  }

  hasFlappingAlert(incident: Incident): boolean {
    return this.ctx.store.alertsByIncident(incident.id, 1000).some((a) => a.flapping);
  }

  private channel(id: string): Channel | null {
    const channel = this.ctx.store.getChannel(id);
    return channel && channel.enabled ? channel : null;
  }

  enqueue(
    channel: Channel,
    incident: Incident,
    kind: NotificationKind,
    routeId: string | null,
    opts: { escalationStep?: number; dedupeKey?: string } = {},
  ): void {
    const now = this.ctx.clock.now();
    const message = buildIncidentMessage(this.ctx, incident, kind, { escalationStep: opts.escalationStep });
    const dedupeKey = opts.dedupeKey ?? (kind === 'incident.opened' ? `${incident.id}:opened:${channel.id}` : `${incident.id}:${kind}:${channel.id}:${now}`);
    const id = this.ctx.store.insertDelivery({ channelId: channel.id, incidentId: incident.id, routeId, kind, message, now, dedupeKey });
    if (id !== null) {
      this.ctx.bus.emit('delivery', { id, status: 'pending', channelId: channel.id, incidentId: incident.id, kind });
    }
  }

  private timeline(incident: Incident, kind: Parameters<EngineContext['store']['addTimeline']>[0]['kind'], message: string, data?: Record<string, unknown>) {
    this.ctx.store.addTimeline({ incidentId: incident.id, ts: this.ctx.clock.now(), kind, message, actor: null, data: data ?? null });
  }

  /** Central decision point. Mutates and persists `incident` (notify state, escalation). */
  evaluate(incident: Incident, trigger: NotifyTrigger): void {
    if (trigger === 'resolved') {
      this.notifyResolved(incident);
      return;
    }
    const now = this.ctx.clock.now();
    const t = this.t;
    const context = this.matchContext(incident);

    if (trigger === 'reopened' && this.hasFlappingAlert(incident)) {
      this.timeline(incident, 'suppressed', t.suppressedFlapping());
      return;
    }

    const silence = this.activeSilence(context, now);
    if (silence) {
      if (incident.notifyState !== 'notified') incident.notifyState = 'suppressed';
      this.ctx.store.updateIncident(incident);
      this.timeline(incident, 'suppressed', t.suppressedSilence(silence.comment), { silenceId: silence.id });
      return;
    }

    const routes = this.matchingRoutes(context);
    if (routes.length === 0) {
      if (incident.notifyState !== 'notified') {
        if (incident.notifyState !== 'none') this.timeline(incident, 'unrouted', t.unrouted());
        incident.notifyState = 'none';
        this.ctx.store.updateIncident(incident);
      }
      return;
    }

    const kind: NotificationKind =
      trigger === 'opened' ? 'incident.opened' : trigger === 'reopened' ? 'incident.reopened' : 'incident.severity';

    // Pass 1: decide per channel. "Immediate" wins over "digest" when several routes target the same channel.
    const immediate = new Map<string, { channel: Channel; routeId: string }>();
    const digest = new Map<string, { channel: Channel; routeId: string; decision: DeliveryDecision }>();
    for (const route of routes) {
      const decision = this.decide(route, incident.severity, now);
      for (const channelId of route.channels) {
        const channel = this.channel(channelId);
        if (!channel) continue;
        if (decision.mode === 'immediate') {
          digest.delete(channelId);
          if (!immediate.has(channelId)) immediate.set(channelId, { channel, routeId: route.id });
        } else if (!immediate.has(channelId) && !digest.has(channelId)) {
          digest.set(channelId, { channel, routeId: route.id, decision });
        }
      }
    }

    // Pass 2: act.
    for (const { channel, routeId } of immediate.values()) this.enqueue(channel, incident, kind, routeId);
    const queuedForDigest: Channel[] = [];
    let firstDue = Number.POSITIVE_INFINITY;
    for (const { channel, routeId, decision } of digest.values()) {
      if (this.ctx.store.hasDigestItem(channel.id, incident.id)) continue;
      const dueAt = decision.dueAt ?? now;
      this.ctx.store.insertDigestItem({
        channelId: channel.id,
        routeId,
        incidentId: incident.id,
        kind,
        createdAt: now,
        dueAt,
        intervalMinutes: decision.intervalMinutes,
      });
      queuedForDigest.push(channel);
      firstDue = Math.min(firstDue, dueAt);
    }

    if (immediate.size > 0) {
      this.timeline(incident, 'notified', t.notified([...immediate.values()].map((v) => v.channel.name), kind), {
        channels: [...immediate.keys()],
        kind,
      });
    }
    if (queuedForDigest.length > 0) {
      this.timeline(incident, 'digest_queued', t.digestQueued(queuedForDigest.map((c) => c.name), Math.max(0, firstDue - now)), {
        channels: queuedForDigest.map((c) => c.id),
      });
    }

    // Escalation: first matching route with a policy wins; only for unacknowledged incidents.
    if (trigger !== 'severity' && incident.status === 'open' && !incident.escalationPolicyId) {
      const route = routes.find((r) => r.escalationPolicyId);
      const policy = route?.escalationPolicyId ? this.ctx.store.getPolicy(route.escalationPolicyId) : undefined;
      if (policy && policy.steps.length > 0) {
        incident.escalationPolicyId = policy.id;
        incident.escalationStep = 0;
        incident.escalationCycle = 0;
        incident.escalationNextAt = now + policy.steps[0].delayMinutes * MINUTE;
        this.timeline(incident, 'escalated', t.escalationStarted(policy.name), { policyId: policy.id });
      }
    }

    const channels = new Set(incident.notifiedChannels);
    for (const id of immediate.keys()) channels.add(id);
    for (const c of queuedForDigest) channels.add(c.id);
    if (immediate.size > 0 || queuedForDigest.length > 0 || incident.notifyState !== 'notified') {
      incident.notifyState = 'notified';
      incident.notifiedSeverity = incident.severity;
    }
    incident.notifiedChannels = [...channels];
    this.ctx.store.updateIncident(incident);
    this.ctx.wake();
  }

  private notifyResolved(incident: Incident): void {
    if (incident.notifyState !== 'notified' || incident.notifiedChannels.length === 0) return;
    if (this.hasFlappingAlert(incident)) return;
    const routes = this.matchingRoutes(this.matchContext(incident));
    // Channels that only belong to routes with notifyResolved=false stay quiet.
    const wantsResolved = new Set<string>();
    const routeChannels = new Set<string>();
    for (const route of routes) {
      for (const id of route.channels) {
        routeChannels.add(id);
        if (route.notifyResolved) wantsResolved.add(id);
      }
    }
    const sent: Channel[] = [];
    for (const id of incident.notifiedChannels) {
      if (routeChannels.has(id) && !wantsResolved.has(id)) continue;
      // Still waiting in a digest? The digest shows the resolved state instead.
      if (this.ctx.store.hasDigestItem(id, incident.id)) continue;
      const channel = this.channel(id);
      if (!channel) continue;
      this.enqueue(channel, incident, 'incident.resolved', null, { dedupeKey: `${incident.id}:resolved:${id}:${incident.resolvedAt ?? 0}` });
      sent.push(channel);
    }
    if (sent.length > 0) {
      this.timeline(incident, 'notified', this.t.notified(sent.map((c) => c.name), 'incident.resolved'), {
        channels: sent.map((c) => c.id),
        kind: 'incident.resolved',
      });
      this.ctx.wake();
    }
  }

  /** Runs due escalation steps. */
  escalate(now: number): number {
    let count = 0;
    for (const incident of this.ctx.store.dueEscalations(now)) {
      this.ctx.store.tx(() => {
        const policy = incident.escalationPolicyId ? this.ctx.store.getPolicy(incident.escalationPolicyId) : undefined;
        const step = policy?.steps[incident.escalationStep];
        if (!policy || !step) {
          incident.escalationNextAt = null;
          this.ctx.store.updateIncident(incident);
          return;
        }
        const level = incident.escalationStep + 1;
        const channels = step.channels.map((id) => this.channel(id)).filter((c): c is Channel => !!c);
        for (const channel of channels) {
          this.enqueue(channel, incident, 'incident.escalated', null, {
            escalationStep: level,
            dedupeKey: `${incident.id}:esc:${incident.escalationCycle}:${incident.escalationStep}:${channel.id}`,
          });
        }
        this.timeline(incident, 'escalated', this.t.escalated(level, channels.map((c) => c.name)), {
          step: level,
          cycle: incident.escalationCycle,
          channels: channels.map((c) => c.id),
        });
        incident.notifiedChannels = [...new Set([...incident.notifiedChannels, ...channels.map((c) => c.id)])];
        if (channels.length > 0) incident.notifyState = 'notified';

        const next = incident.escalationStep + 1;
        if (next < policy.steps.length) {
          incident.escalationStep = next;
          incident.escalationNextAt = now + policy.steps[next].delayMinutes * MINUTE;
        } else if (incident.escalationCycle < policy.repeat) {
          incident.escalationCycle += 1;
          incident.escalationStep = 0;
          incident.escalationNextAt = now + Math.max(1, policy.steps[0].delayMinutes) * MINUTE;
        } else {
          incident.escalationNextAt = null;
          this.timeline(incident, 'escalated', this.t.escalationExhausted());
        }
        this.ctx.store.updateIncident(incident);
        this.ctx.bus.emit('incident', incident);
        count++;
      });
    }
    if (count > 0) this.ctx.wake();
    return count;
  }
}
