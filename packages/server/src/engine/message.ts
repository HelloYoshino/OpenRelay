import type { Alert, Incident, NotificationField, NotificationKind, NotificationMessage } from '../types.js';
import { truncate } from '../util/json.js';
import type { EngineContext } from './context.js';
import { messages } from './i18n.js';
import { SEVERITY_EMOJI, compareSeverity, severityLabel } from './severity.js';

export function incidentUrl(publicUrl: string, incidentId: string): string {
  return `${publicUrl}/#/incidents/${incidentId}`;
}

export function actionUrl(ctx: EngineContext, incidentId: string, action: 'ack' | 'resolve'): string {
  return `${ctx.publicUrl}/a/${incidentId}/${action}?sig=${ctx.sign(incidentId, action)}`;
}

function statusLabel(ctx: EngineContext, status: Incident['status']): string {
  const t = messages(ctx.settings().locale).notify;
  return status === 'resolved' ? t.statusResolved : status === 'acknowledged' ? t.statusAcknowledged : t.statusOpen;
}

export function buildIncidentMessage(
  ctx: EngineContext,
  incident: Incident,
  kind: NotificationKind,
  opts: { rootAlert?: Alert | null; escalationStep?: number } = {},
): NotificationMessage {
  const locale = ctx.settings().locale;
  const t = messages(locale).notify;
  const now = ctx.clock.now();
  const root = opts.rootAlert !== undefined ? opts.rootAlert : incident.rootAlertId ? ctx.store.getAlert(incident.rootAlertId) ?? null : null;
  const sev = severityLabel(incident.severity, locale);
  const p = `[P${incident.priority}]`;
  const name = `#${incident.number} ${incident.title}`;

  let title: string;
  switch (kind) {
    case 'incident.reopened':
      title = `🔁 ${p} ${t.reopened}: ${name}`;
      break;
    case 'incident.severity':
      title = `⬆️ ${p} ${t.severity(sev)}: ${name}`;
      break;
    case 'incident.escalated':
      title = `⏫ ${p} ${t.escalated(opts.escalationStep ?? 1)}: ${name}`;
      break;
    case 'incident.resolved':
      title = `✅ ${t.resolved}: ${name}`;
      break;
    default:
      title = `${SEVERITY_EMOJI[incident.severity]} ${p} ${name}`;
  }

  const lines: string[] = [];
  if (root?.message) lines.push(truncate(root.message, 1500));
  lines.push(t.alertsLine(incident.alertCount, incident.eventCount));
  if (kind === 'incident.escalated') lines.push(t.unacknowledgedFor(now - incident.createdAt));
  if (kind === 'incident.resolved' && incident.resolvedAt) lines.push(t.resolvedAfter(incident.resolvedAt - incident.createdAt));
  if (incident.recurrenceCount > 0 && kind !== 'incident.resolved') lines.push(t.recurrence(incident.recurrenceCount + 1));

  const fields: NotificationField[] = [
    { name: t.fieldSeverity, value: sev },
    { name: t.fieldPriority, value: `P${incident.priority}` },
  ];
  if (incident.services.length) fields.push({ name: t.fieldServices, value: truncate(incident.services.join(', '), 300) });
  if (incident.sources.length) fields.push({ name: t.fieldSources, value: truncate(incident.sources.join(', '), 300) });
  if (root?.host) fields.push({ name: t.fieldHost, value: root.host });
  if (incident.alertCount > 1 && root) {
    fields.push({ name: t.fieldRootCause, value: truncate(`${root.title}${incident.rootReason ? ` – ${incident.rootReason}` : ''}`, 500) });
  }

  return {
    kind,
    title: truncate(title, 300),
    text: lines.join('\n'),
    severity: incident.severity,
    priority: incident.priority,
    status: incident.status,
    timestamp: now,
    url: incidentUrl(ctx.publicUrl, incident.id),
    ackUrl: actionUrl(ctx, incident.id, 'ack'),
    resolveUrl: actionUrl(ctx, incident.id, 'resolve'),
    incident: {
      id: incident.id,
      number: incident.number,
      title: incident.title,
      alertCount: incident.alertCount,
      eventCount: incident.eventCount,
      services: incident.services,
      sources: incident.sources,
      rootCause: root ? root.title : null,
      sourceUrl: root?.url ?? null,
    },
    fields,
    items: [],
    escalationStep: opts.escalationStep ?? null,
  };
}

export function buildDigestMessage(ctx: EngineContext, incidents: Incident[], minutes: number): NotificationMessage {
  const locale = ctx.settings().locale;
  const t = messages(locale).notify;
  const sorted = [...incidents].sort((a, b) => compareSeverity(b.severity, a.severity) || a.createdAt - b.createdAt);
  const top = sorted[0];
  const lines = [t.digestIntro(minutes)];
  for (const inc of sorted.slice(0, 25)) {
    const mark = inc.status === 'resolved' ? '✅' : SEVERITY_EMOJI[inc.severity];
    lines.push(`${mark} #${inc.number} ${truncate(inc.title, 120)} – ${t.alertsLine(inc.alertCount, inc.eventCount)} (${statusLabel(ctx, inc.status)})`);
  }
  if (sorted.length > 25) lines.push(`… +${sorted.length - 25}`);
  return {
    kind: 'digest',
    title: `📋 ${t.digest(incidents.length)}`,
    text: lines.join('\n'),
    severity: top?.severity ?? 'info',
    priority: Math.min(...incidents.map((i) => i.priority), 5),
    status: null,
    timestamp: ctx.clock.now(),
    url: `${ctx.publicUrl}/#/incidents`,
    ackUrl: null,
    resolveUrl: null,
    incident: null,
    fields: [],
    items: sorted.map((i) => ({
      incidentId: i.id,
      number: i.number,
      title: i.title,
      severity: i.severity,
      status: i.status,
      alertCount: i.alertCount,
      eventCount: i.eventCount,
      url: incidentUrl(ctx.publicUrl, i.id),
    })),
    escalationStep: null,
  };
}

export function buildTestMessage(ctx: EngineContext, channelName: string): NotificationMessage {
  const t = messages(ctx.settings().locale).notify;
  return {
    kind: 'test',
    title: `🧪 ${t.test}`,
    text: `${t.testText}\n${channelName}`,
    severity: 'info',
    priority: 4,
    status: null,
    timestamp: ctx.clock.now(),
    url: ctx.publicUrl,
    ackUrl: null,
    resolveUrl: null,
    incident: null,
    fields: [],
    items: [],
    escalationStep: null,
  };
}
