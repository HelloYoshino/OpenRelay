import type {
  Alert,
  ApiKey,
  ApiScope,
  Channel,
  Delivery,
  DeliveryStatus,
  EscalationPolicy,
  EventAction,
  Incident,
  IncidentLink,
  IncidentLinkKind,
  IncidentStatus,
  NotificationKind,
  NotificationMessage,
  QuietHours,
  Route,
  ServiceDependency,
  Severity,
  Silence,
  StoredEvent,
  TimelineEntry,
  TimelineKind,
} from '../types.js';
import { parseJson } from '../util/json.js';
import type { Database, SqlValue } from './database.js';

type Row = Record<string, SqlValue>;

const str = (v: SqlValue): string => (v === null ? '' : String(v));
const strOrNull = (v: SqlValue): string | null => (v === null || v === undefined ? null : String(v));
const num = (v: SqlValue): number => Number(v ?? 0);
const numOrNull = (v: SqlValue): number | null => (v === null || v === undefined ? null : Number(v));
const bool = (v: SqlValue): boolean => Number(v) === 1;
const json = <T>(v: SqlValue, fallback: T): T => parseJson<T>(v === null ? null : String(v), fallback);

function placeholders(values: unknown[]): string {
  return values.map(() => '?').join(', ');
}

// ---------------------------------------------------------------- mappers

function toEvent(r: Row): StoredEvent {
  return {
    id: str(r.id),
    receivedAt: num(r.received_at),
    occurredAt: num(r.occurred_at),
    source: str(r.source),
    type: strOrNull(r.type),
    title: str(r.title),
    message: strOrNull(r.message),
    severity: str(r.severity) as Severity,
    status: str(r.status) as StoredEvent['status'],
    service: strOrNull(r.service),
    host: strOrNull(r.host),
    fingerprint: str(r.fingerprint),
    correlationKey: strOrNull(r.correlation_key),
    labels: json(r.labels, {}),
    url: strOrNull(r.url),
    ttl: numOrNull(r.ttl),
    payload: json(r.payload, null),
    alertId: strOrNull(r.alert_id),
    incidentId: strOrNull(r.incident_id),
    action: str(r.action) as EventAction,
  };
}

function toAlert(r: Row): Alert {
  return {
    id: str(r.id),
    fingerprint: str(r.fingerprint),
    source: str(r.source),
    type: strOrNull(r.type),
    title: str(r.title),
    message: strOrNull(r.message),
    severity: str(r.severity) as Severity,
    baseSeverity: str(r.base_severity) as Severity,
    status: str(r.status) as Alert['status'],
    service: strOrNull(r.service),
    host: strOrNull(r.host),
    correlationKey: strOrNull(r.correlation_key),
    labels: json(r.labels, {}),
    url: strOrNull(r.url),
    firstSeen: num(r.first_seen),
    lastSeen: num(r.last_seen),
    resolvedAt: numOrNull(r.resolved_at),
    count: num(r.count),
    incidentId: strOrNull(r.incident_id),
    ttl: numOrNull(r.ttl),
    flapping: bool(r.flapping),
    stateChanges: json(r.state_changes, []),
  };
}

function toIncident(r: Row): Incident {
  return {
    id: str(r.id),
    number: num(r.number),
    title: str(r.title),
    status: str(r.status) as IncidentStatus,
    severity: str(r.severity) as Severity,
    priority: num(r.priority),
    createdAt: num(r.created_at),
    updatedAt: num(r.updated_at),
    lastActivityAt: num(r.last_activity_at),
    acknowledgedAt: numOrNull(r.acknowledged_at),
    acknowledgedBy: strOrNull(r.acknowledged_by),
    resolvedAt: numOrNull(r.resolved_at),
    resolvedBy: strOrNull(r.resolved_by),
    rootAlertId: strOrNull(r.root_alert_id),
    rootFingerprint: strOrNull(r.root_fingerprint),
    rootReason: strOrNull(r.root_reason),
    services: json(r.services, []),
    sources: json(r.sources, []),
    labels: json(r.labels, {}),
    correlationKey: strOrNull(r.correlation_key),
    alertCount: num(r.alert_count),
    firingCount: num(r.firing_count),
    eventCount: num(r.event_count),
    storm: bool(r.storm),
    recurrenceCount: num(r.recurrence_count),
    notifyState: str(r.notify_state) as Incident['notifyState'],
    notifiedSeverity: strOrNull(r.notified_severity) as Severity | null,
    notifiedChannels: json(r.notified_channels, []),
    escalationPolicyId: strOrNull(r.escalation_policy_id),
    escalationStep: num(r.escalation_step),
    escalationCycle: num(r.escalation_cycle),
    escalationNextAt: numOrNull(r.escalation_next_at),
  };
}

function toTimeline(r: Row): TimelineEntry {
  return {
    id: num(r.id),
    incidentId: str(r.incident_id),
    ts: num(r.ts),
    kind: str(r.kind) as TimelineKind,
    message: str(r.message),
    actor: strOrNull(r.actor),
    data: json(r.data, null),
  };
}

function toLink(r: Row): IncidentLink {
  return {
    incidentId: str(r.incident_id),
    relatedId: str(r.related_id),
    kind: str(r.kind) as IncidentLinkKind,
    score: numOrNull(r.score),
    reason: strOrNull(r.reason),
    createdAt: num(r.created_at),
  };
}

function toChannel(r: Row): Channel {
  return {
    id: str(r.id),
    name: str(r.name),
    type: str(r.type),
    config: json(r.config, {}),
    enabled: bool(r.enabled),
    createdAt: num(r.created_at),
    updatedAt: num(r.updated_at),
    consecutiveFailures: num(r.consecutive_failures),
    circuitOpenUntil: numOrNull(r.circuit_open_until),
    lastSuccessAt: numOrNull(r.last_success_at),
    lastErrorAt: numOrNull(r.last_error_at),
    lastError: strOrNull(r.last_error),
  };
}

function toRoute(r: Row): Route {
  return {
    id: str(r.id),
    name: str(r.name),
    position: num(r.position),
    enabled: bool(r.enabled),
    matchers: json(r.matchers, []),
    channels: json(r.channels, []),
    delivery: str(r.delivery) as Route['delivery'],
    digestMinutes: numOrNull(r.digest_minutes),
    escalationPolicyId: strOrNull(r.escalation_policy_id),
    quietHours: json<QuietHours | null>(r.quiet_hours, null),
    notifyResolved: bool(r.notify_resolved),
    stop: bool(r.stop),
    createdAt: num(r.created_at),
    updatedAt: num(r.updated_at),
  };
}

function toPolicy(r: Row): EscalationPolicy {
  return {
    id: str(r.id),
    name: str(r.name),
    steps: json(r.steps, []),
    repeat: num(r.repeat),
    createdAt: num(r.created_at),
    updatedAt: num(r.updated_at),
  };
}

function toSilence(r: Row): Silence {
  return {
    id: str(r.id),
    matchers: json(r.matchers, []),
    startsAt: num(r.starts_at),
    endsAt: num(r.ends_at),
    comment: strOrNull(r.comment),
    createdBy: strOrNull(r.created_by),
    createdAt: num(r.created_at),
  };
}

function toDelivery(r: Row): Delivery {
  return {
    id: num(r.id),
    channelId: str(r.channel_id),
    incidentId: strOrNull(r.incident_id),
    routeId: strOrNull(r.route_id),
    kind: str(r.kind) as NotificationKind,
    message: json<NotificationMessage>(r.message, null as unknown as NotificationMessage),
    status: str(r.status) as DeliveryStatus,
    attempts: num(r.attempts),
    nextAttemptAt: num(r.next_attempt_at),
    lastError: strOrNull(r.last_error),
    createdAt: num(r.created_at),
    updatedAt: num(r.updated_at),
    sentAt: numOrNull(r.sent_at),
  };
}

function toApiKey(r: Row): ApiKey {
  return {
    id: str(r.id),
    name: str(r.name),
    prefix: str(r.prefix),
    scopes: json<ApiScope[]>(r.scopes, []),
    defaultSource: strOrNull(r.default_source),
    createdAt: num(r.created_at),
    lastUsedAt: numOrNull(r.last_used_at),
  };
}

// ---------------------------------------------------------------- repositories

export interface EventFilter {
  q?: string;
  source?: string;
  severity?: Severity;
  alertId?: string;
  incidentId?: string;
  before?: number;
  limit?: number;
}

export interface IncidentFilter {
  status?: IncidentStatus[];
  severity?: Severity[];
  q?: string;
  limit?: number;
  offset?: number;
}

export interface DigestItem {
  id: number;
  channelId: string;
  routeId: string | null;
  incidentId: string;
  kind: NotificationKind;
  createdAt: number;
  dueAt: number;
  intervalMinutes: number;
}

export class Store {
  constructor(readonly db: Database) {}

  tx<T>(fn: () => T): T {
    return this.db.tx(fn);
  }

  // ------------------------------------------------------------ settings
  getSetting<T>(key: string): T | undefined {
    const row = this.db.get<{ value: string }>('SELECT value FROM settings WHERE key = ?', [key]);
    return row ? parseJson<T | undefined>(row.value, undefined) : undefined;
  }

  setSetting(key: string, value: unknown): void {
    this.db.run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [
      key,
      JSON.stringify(value),
    ]);
  }

  // ------------------------------------------------------------ events
  insertEvent(e: StoredEvent): void {
    this.db.run(
      `INSERT INTO events (id, received_at, occurred_at, source, type, title, message, severity, status, service, host,
         fingerprint, correlation_key, labels, url, ttl, payload, alert_id, incident_id, action)
       VALUES (:id, :received_at, :occurred_at, :source, :type, :title, :message, :severity, :status, :service, :host,
         :fingerprint, :correlation_key, :labels, :url, :ttl, :payload, :alert_id, :incident_id, :action)`,
      {
        id: e.id,
        received_at: e.receivedAt,
        occurred_at: e.occurredAt,
        source: e.source,
        type: e.type,
        title: e.title,
        message: e.message,
        severity: e.severity,
        status: e.status,
        service: e.service,
        host: e.host,
        fingerprint: e.fingerprint,
        correlation_key: e.correlationKey,
        labels: JSON.stringify(e.labels),
        url: e.url,
        ttl: e.ttl,
        payload: e.payload === undefined || e.payload === null ? null : JSON.stringify(e.payload),
        alert_id: e.alertId,
        incident_id: e.incidentId,
        action: e.action,
      },
    );
  }

  listEvents(f: EventFilter): StoredEvent[] {
    const where: string[] = [];
    const params: SqlValue[] = [];
    if (f.q) {
      where.push('(title LIKE ? OR message LIKE ?)');
      params.push(`%${f.q}%`, `%${f.q}%`);
    }
    if (f.source) {
      where.push('source = ?');
      params.push(f.source);
    }
    if (f.severity) {
      where.push('severity = ?');
      params.push(f.severity);
    }
    if (f.alertId) {
      where.push('alert_id = ?');
      params.push(f.alertId);
    }
    if (f.incidentId) {
      where.push('incident_id = ?');
      params.push(f.incidentId);
    }
    if (f.before) {
      where.push('received_at < ?');
      params.push(f.before);
    }
    const sql = `SELECT * FROM events ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY received_at DESC, id DESC LIMIT ?`;
    params.push(Math.min(Math.max(f.limit ?? 100, 1), 1000));
    return this.db.raw.prepare(sql).all(...params).map((r) => toEvent(r as Row));
  }

  countAlertEventsSince(alertId: string, since: number): number {
    return num(this.db.get<Row>('SELECT COUNT(*) AS c FROM events WHERE alert_id = ? AND received_at >= ?', [alertId, since])!.c);
  }

  countEventsSince(since: number): number {
    return num(this.db.get<Row>('SELECT COUNT(*) AS c FROM events WHERE received_at >= ?', [since])!.c);
  }

  eventSeries(since: number, bucketMs: number): Array<{ bucket: number; count: number }> {
    return this.db
      .all<Row>('SELECT CAST(received_at / ? AS INTEGER) AS bucket, COUNT(*) AS c FROM events WHERE received_at >= ? GROUP BY bucket', [
        bucketMs,
        since,
      ])
      .map((r) => ({ bucket: num(r.bucket), count: num(r.c) }));
  }

  topSources(since: number, limit = 8): Array<{ source: string; count: number }> {
    return this.db
      .all<Row>(
        'SELECT source, COUNT(*) AS c FROM events WHERE received_at >= ? GROUP BY source ORDER BY c DESC LIMIT ?',
        [since, limit],
      )
      .map((r) => ({ source: str(r.source), count: num(r.c) }));
  }

  pruneEvents(before: number): number {
    return this.db.run('DELETE FROM events WHERE received_at < ?', [before]).changes;
  }

  // ------------------------------------------------------------ alerts
  private alertParams(a: Alert): Record<string, SqlValue> {
    return {
      id: a.id,
      fingerprint: a.fingerprint,
      source: a.source,
      type: a.type,
      title: a.title,
      message: a.message,
      severity: a.severity,
      base_severity: a.baseSeverity,
      status: a.status,
      service: a.service,
      host: a.host,
      correlation_key: a.correlationKey,
      labels: JSON.stringify(a.labels),
      url: a.url,
      first_seen: a.firstSeen,
      last_seen: a.lastSeen,
      resolved_at: a.resolvedAt,
      count: a.count,
      incident_id: a.incidentId,
      ttl: a.ttl,
      flapping: a.flapping ? 1 : 0,
      state_changes: JSON.stringify(a.stateChanges),
    };
  }

  insertAlert(a: Alert): void {
    this.db.run(
      `INSERT INTO alerts (id, fingerprint, source, type, title, message, severity, base_severity, status, service, host,
         correlation_key, labels, url, first_seen, last_seen, resolved_at, count, incident_id, ttl, flapping, state_changes)
       VALUES (:id, :fingerprint, :source, :type, :title, :message, :severity, :base_severity, :status, :service, :host,
         :correlation_key, :labels, :url, :first_seen, :last_seen, :resolved_at, :count, :incident_id, :ttl, :flapping, :state_changes)`,
      this.alertParams(a),
    );
  }

  updateAlert(a: Alert): void {
    this.db.run(
      `UPDATE alerts SET fingerprint = :fingerprint, source = :source, type = :type, title = :title, message = :message,
         severity = :severity, base_severity = :base_severity, status = :status, service = :service, host = :host,
         correlation_key = :correlation_key, labels = :labels, url = :url, first_seen = :first_seen, last_seen = :last_seen,
         resolved_at = :resolved_at, count = :count, incident_id = :incident_id, ttl = :ttl, flapping = :flapping,
         state_changes = :state_changes
       WHERE id = :id`,
      this.alertParams(a),
    );
  }

  getAlert(id: string): Alert | undefined {
    const r = this.db.get<Row>('SELECT * FROM alerts WHERE id = ?', [id]);
    return r ? toAlert(r) : undefined;
  }

  /** Most recent alert for a fingerprint (firing or resolved). */
  latestAlertByFingerprint(fingerprint: string): Alert | undefined {
    const r = this.db.get<Row>('SELECT * FROM alerts WHERE fingerprint = ? ORDER BY last_seen DESC LIMIT 1', [fingerprint]);
    return r ? toAlert(r) : undefined;
  }

  alertsByIncident(incidentId: string, limit = 500): Alert[] {
    return this.db
      .all<Row>('SELECT * FROM alerts WHERE incident_id = ? ORDER BY first_seen ASC LIMIT ?', [incidentId, limit])
      .map(toAlert);
  }

  /** Most recently active alerts of an incident – enough for correlation scoring. */
  recentAlertsByIncident(incidentId: string, limit: number): Alert[] {
    return this.db
      .all<Row>('SELECT * FROM alerts WHERE incident_id = ? ORDER BY last_seen DESC LIMIT ?', [incidentId, limit])
      .map(toAlert);
  }

  incidentAlertStats(incidentId: string): {
    alertCount: number;
    firingCount: number;
    eventCount: number;
    services: string[];
    sources: string[];
    firingSeverities: Severity[];
    allSeverities: Severity[];
  } {
    const agg = this.db.get<Row>(
      `SELECT COUNT(*) AS alerts, COALESCE(SUM(status = 'firing'), 0) AS firing, COALESCE(SUM(count), 0) AS events
       FROM alerts WHERE incident_id = ?`,
      [incidentId],
    )!;
    const services = this.db
      .all<Row>('SELECT DISTINCT service FROM alerts WHERE incident_id = ? AND service IS NOT NULL ORDER BY service', [incidentId])
      .map((r) => str(r.service));
    const sources = this.db
      .all<Row>('SELECT DISTINCT source FROM alerts WHERE incident_id = ? ORDER BY source', [incidentId])
      .map((r) => str(r.source));
    const sev = this.db.all<Row>('SELECT DISTINCT severity, status FROM alerts WHERE incident_id = ?', [incidentId]);
    return {
      alertCount: num(agg.alerts),
      firingCount: num(agg.firing),
      eventCount: num(agg.events),
      services,
      sources,
      firingSeverities: sev.filter((r) => r.status === 'firing').map((r) => str(r.severity) as Severity),
      allSeverities: sev.map((r) => str(r.severity) as Severity),
    };
  }

  listAlerts(f: { status?: Alert['status']; incidentId?: string; limit?: number; offset?: number }): { items: Alert[]; total: number } {
    const where: string[] = [];
    const params: SqlValue[] = [];
    if (f.status) {
      where.push('status = ?');
      params.push(f.status);
    }
    if (f.incidentId) {
      where.push('incident_id = ?');
      params.push(f.incidentId);
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = num((this.db.raw.prepare(`SELECT COUNT(*) AS c FROM alerts ${clause}`).get(...params) as Row).c);
    const items = this.db.raw
      .prepare(`SELECT * FROM alerts ${clause} ORDER BY last_seen DESC LIMIT ? OFFSET ?`)
      .all(...params, Math.min(f.limit ?? 100, 1000), f.offset ?? 0)
      .map((r) => toAlert(r as Row));
    return { items, total };
  }

  /** Firing alerts whose TTL (or the global auto-resolve timeout) has expired. */
  expiredAlerts(now: number, defaultTimeoutMs: number): Alert[] {
    return this.db
      .all<Row>(
        `SELECT * FROM alerts WHERE status = 'firing' AND (
           (ttl IS NULL AND :default_ms > 0 AND last_seen + :default_ms < :now) OR
           (ttl > 0 AND last_seen + ttl * 1000 < :now)
         ) LIMIT 500`,
        { now, default_ms: defaultTimeoutMs },
      )
      .map(toAlert);
  }

  flappingAlerts(): Alert[] {
    return this.db.all<Row>('SELECT * FROM alerts WHERE flapping = 1').map(toAlert);
  }

  countAlertsCreatedSince(since: number): number {
    return num(this.db.get<Row>('SELECT COUNT(*) AS c FROM alerts WHERE first_seen >= ?', [since])!.c);
  }

  knownServices(): string[] {
    return this.db
      .all<Row>('SELECT DISTINCT service FROM alerts WHERE service IS NOT NULL ORDER BY service LIMIT 500')
      .map((r) => str(r.service));
  }

  // ------------------------------------------------------------ incidents
  private incidentParams(i: Incident): Record<string, SqlValue> {
    return {
      id: i.id,
      number: i.number,
      title: i.title,
      status: i.status,
      severity: i.severity,
      priority: i.priority,
      created_at: i.createdAt,
      updated_at: i.updatedAt,
      last_activity_at: i.lastActivityAt,
      acknowledged_at: i.acknowledgedAt,
      acknowledged_by: i.acknowledgedBy,
      resolved_at: i.resolvedAt,
      resolved_by: i.resolvedBy,
      root_alert_id: i.rootAlertId,
      root_fingerprint: i.rootFingerprint,
      root_reason: i.rootReason,
      services: JSON.stringify(i.services),
      sources: JSON.stringify(i.sources),
      labels: JSON.stringify(i.labels),
      correlation_key: i.correlationKey,
      alert_count: i.alertCount,
      firing_count: i.firingCount,
      event_count: i.eventCount,
      storm: i.storm ? 1 : 0,
      recurrence_count: i.recurrenceCount,
      notify_state: i.notifyState,
      notified_severity: i.notifiedSeverity,
      notified_channels: JSON.stringify(i.notifiedChannels),
      escalation_policy_id: i.escalationPolicyId,
      escalation_step: i.escalationStep,
      escalation_cycle: i.escalationCycle,
      escalation_next_at: i.escalationNextAt,
    };
  }

  nextIncidentNumber(): number {
    return num(this.db.get<Row>('SELECT COALESCE(MAX(number), 0) + 1 AS n FROM incidents')!.n);
  }

  insertIncident(i: Incident): void {
    const p = this.incidentParams(i);
    const cols = Object.keys(p);
    this.db.run(`INSERT INTO incidents (${cols.join(', ')}) VALUES (${cols.map((c) => `:${c}`).join(', ')})`, p);
  }

  updateIncident(i: Incident): void {
    const p = this.incidentParams(i);
    const sets = Object.keys(p)
      .filter((c) => c !== 'id')
      .map((c) => `${c} = :${c}`);
    this.db.run(`UPDATE incidents SET ${sets.join(', ')} WHERE id = :id`, p);
  }

  getIncident(id: string): Incident | undefined {
    const r = this.db.get<Row>('SELECT * FROM incidents WHERE id = ?', [id]);
    return r ? toIncident(r) : undefined;
  }

  getIncidentByNumber(n: number): Incident | undefined {
    const r = this.db.get<Row>('SELECT * FROM incidents WHERE number = ?', [n]);
    return r ? toIncident(r) : undefined;
  }

  getIncidentsByIds(ids: string[]): Incident[] {
    if (ids.length === 0) return [];
    return this.db.raw
      .prepare(`SELECT * FROM incidents WHERE id IN (${placeholders(ids)})`)
      .all(...ids)
      .map((r) => toIncident(r as Row));
  }

  listIncidents(f: IncidentFilter): { items: Incident[]; total: number } {
    const where: string[] = [];
    const params: SqlValue[] = [];
    if (f.status?.length) {
      where.push(`status IN (${placeholders(f.status)})`);
      params.push(...f.status);
    }
    if (f.severity?.length) {
      where.push(`severity IN (${placeholders(f.severity)})`);
      params.push(...f.severity);
    }
    if (f.q) {
      const n = Number(f.q.replace(/^#/, ''));
      if (Number.isInteger(n) && n > 0) {
        where.push('(number = ? OR title LIKE ?)');
        params.push(n, `%${f.q}%`);
      } else {
        where.push('(title LIKE ? OR services LIKE ? OR sources LIKE ?)');
        params.push(`%${f.q}%`, `%${f.q}%`, `%${f.q}%`);
      }
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = num((this.db.raw.prepare(`SELECT COUNT(*) AS c FROM incidents ${clause}`).get(...params) as Row).c);
    const items = this.db.raw
      .prepare(`SELECT * FROM incidents ${clause} ORDER BY last_activity_at DESC LIMIT ? OFFSET ?`)
      .all(...params, Math.min(f.limit ?? 50, 500), f.offset ?? 0)
      .map((r) => toIncident(r as Row));
    return { items, total };
  }

  /** Open incidents that are still within the correlation window. */
  correlationCandidates(cutoff: number, limit = 200): Incident[] {
    return this.db
      .all<Row>(
        `SELECT * FROM incidents WHERE status != 'resolved' AND last_activity_at >= ?
         ORDER BY last_activity_at DESC LIMIT ?`,
        [cutoff, limit],
      )
      .map(toIncident);
  }

  openIncidentByCorrelationKey(key: string): Incident | undefined {
    const r = this.db.get<Row>(
      `SELECT i.* FROM incidents i WHERE i.status != 'resolved' AND (i.correlation_key = ? OR EXISTS (
         SELECT 1 FROM alerts a WHERE a.incident_id = i.id AND a.correlation_key = ?))
       ORDER BY i.last_activity_at DESC LIMIT 1`,
      [key, key],
    );
    return r ? toIncident(r) : undefined;
  }

  openStormIncident(): Incident | undefined {
    const r = this.db.get<Row>(
      "SELECT * FROM incidents WHERE storm = 1 AND status != 'resolved' ORDER BY created_at DESC LIMIT 1",
    );
    return r ? toIncident(r) : undefined;
  }

  dueEscalations(now: number): Incident[] {
    return this.db
      .all<Row>(
        "SELECT * FROM incidents WHERE status = 'open' AND escalation_next_at IS NOT NULL AND escalation_next_at <= ? LIMIT 100",
        [now],
      )
      .map(toIncident);
  }

  suppressedOpenIncidents(): Incident[] {
    return this.db
      .all<Row>("SELECT * FROM incidents WHERE status != 'resolved' AND notify_state = 'suppressed' LIMIT 500")
      .map(toIncident);
  }

  openIncidentsWithResolvedAlerts(): Incident[] {
    return this.db
      .all<Row>("SELECT * FROM incidents WHERE status != 'resolved' AND firing_count = 0 AND alert_count > 0 LIMIT 500")
      .map(toIncident);
  }

  /** Earlier incidents caused by the same root fingerprint. */
  previousOccurrences(rootFingerprint: string, since: number, excludeId: string): Incident[] {
    return this.db
      .all<Row>(
        `SELECT * FROM incidents WHERE root_fingerprint = ? AND created_at >= ? AND id != ?
         ORDER BY created_at DESC LIMIT 50`,
        [rootFingerprint, since, excludeId],
      )
      .map(toIncident);
  }

  incidentCounts(): Record<IncidentStatus, number> {
    const rows = this.db.all<Row>("SELECT status, COUNT(*) AS c FROM incidents WHERE status != 'resolved' GROUP BY status");
    const out: Record<IncidentStatus, number> = { open: 0, acknowledged: 0, resolved: 0 };
    for (const r of rows) out[str(r.status) as IncidentStatus] = num(r.c);
    return out;
  }

  openSeverityCounts(): Record<Severity, number> {
    const out: Record<Severity, number> = { debug: 0, info: 0, warning: 0, high: 0, critical: 0 };
    for (const r of this.db.all<Row>("SELECT severity, COUNT(*) AS c FROM incidents WHERE status != 'resolved' GROUP BY severity")) {
      out[str(r.severity) as Severity] = num(r.c);
    }
    return out;
  }

  incidentWindowStats(since: number): { created: number; resolved: number; mttaMs: number | null; mttrMs: number | null } {
    const r = this.db.get<Row>(
      `SELECT
         (SELECT COUNT(*) FROM incidents WHERE created_at >= :since) AS created,
         (SELECT COUNT(*) FROM incidents WHERE resolved_at >= :since) AS resolved,
         (SELECT AVG(acknowledged_at - created_at) FROM incidents WHERE acknowledged_at IS NOT NULL AND created_at >= :since) AS mtta,
         (SELECT AVG(resolved_at - created_at) FROM incidents WHERE resolved_at IS NOT NULL AND created_at >= :since
            AND (resolved_by IS NULL OR resolved_by NOT LIKE 'merge%')) AS mttr`,
      { since },
    )!;
    return { created: num(r.created), resolved: num(r.resolved), mttaMs: numOrNull(r.mtta), mttrMs: numOrNull(r.mttr) };
  }

  pruneResolvedIncidents(before: number): number {
    return this.tx(() => {
      const ids = this.db
        .all<Row>("SELECT id FROM incidents WHERE status = 'resolved' AND resolved_at < ? LIMIT 5000", [before])
        .map((r) => str(r.id));
      if (ids.length === 0) return 0;
      const ph = placeholders(ids);
      for (const sql of [
        `DELETE FROM incident_timeline WHERE incident_id IN (${ph})`,
        `DELETE FROM incident_links WHERE incident_id IN (${ph})`,
        `DELETE FROM incident_links WHERE related_id IN (${ph})`,
        `DELETE FROM alerts WHERE incident_id IN (${ph})`,
        `DELETE FROM digest_queue WHERE incident_id IN (${ph})`,
        `DELETE FROM incidents WHERE id IN (${ph})`,
      ]) {
        this.db.raw.prepare(sql).run(...ids);
      }
      return ids.length;
    });
  }

  // ------------------------------------------------------------ timeline & links
  addTimeline(e: Omit<TimelineEntry, 'id'>): TimelineEntry {
    const { lastInsertRowid } = this.db.run(
      'INSERT INTO incident_timeline (incident_id, ts, kind, message, actor, data) VALUES (?, ?, ?, ?, ?, ?)',
      [e.incidentId, e.ts, e.kind, e.message, e.actor, e.data ? JSON.stringify(e.data) : null],
    );
    return { ...e, id: lastInsertRowid };
  }

  timeline(incidentId: string, limit = 500): TimelineEntry[] {
    return this.db
      .all<Row>('SELECT * FROM incident_timeline WHERE incident_id = ? ORDER BY id DESC LIMIT ?', [incidentId, limit])
      .map(toTimeline)
      .reverse();
  }

  addLink(l: IncidentLink): void {
    this.db.run(
      `INSERT INTO incident_links (incident_id, related_id, kind, score, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (incident_id, related_id, kind) DO UPDATE SET score = excluded.score, reason = excluded.reason`,
      [l.incidentId, l.relatedId, l.kind, l.score, l.reason, l.createdAt],
    );
  }

  linksFor(incidentId: string): IncidentLink[] {
    return this.db
      .all<Row>('SELECT * FROM incident_links WHERE incident_id = ? OR related_id = ? ORDER BY created_at DESC', [
        incidentId,
        incidentId,
      ])
      .map(toLink);
  }

  // ------------------------------------------------------------ learned correlations
  allLearned(): Array<{ fpA: string; fpB: string; weight: number }> {
    return this.db
      .all<Row>('SELECT fp_a, fp_b, weight FROM learned_correlations')
      .map((r) => ({ fpA: str(r.fp_a), fpB: str(r.fp_b), weight: num(r.weight) }));
  }

  setLearned(fpA: string, fpB: string, weight: number, origin: string, now: number): void {
    const [a, b] = fpA < fpB ? [fpA, fpB] : [fpB, fpA];
    this.db.run(
      `INSERT INTO learned_correlations (fp_a, fp_b, weight, created_at, origin) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (fp_a, fp_b) DO UPDATE SET weight = excluded.weight, created_at = excluded.created_at, origin = excluded.origin`,
      [a, b, weight, now, origin],
    );
  }

  // ------------------------------------------------------------ channels
  listChannels(): Channel[] {
    return this.db.all<Row>('SELECT * FROM channels ORDER BY name').map(toChannel);
  }

  getChannel(id: string): Channel | undefined {
    const r = this.db.get<Row>('SELECT * FROM channels WHERE id = ?', [id]);
    return r ? toChannel(r) : undefined;
  }

  upsertChannel(c: Pick<Channel, 'id' | 'name' | 'type' | 'config' | 'enabled'>, now: number): Channel {
    this.db.run(
      `INSERT INTO channels (id, name, type, config, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET name = excluded.name, type = excluded.type, config = excluded.config,
         enabled = excluded.enabled, updated_at = excluded.updated_at`,
      [c.id, c.name, c.type, JSON.stringify(c.config), c.enabled ? 1 : 0, now, now],
    );
    return this.getChannel(c.id)!;
  }

  deleteChannel(id: string): boolean {
    return this.db.run('DELETE FROM channels WHERE id = ?', [id]).changes > 0;
  }

  recordChannelSuccess(id: string, now: number): void {
    this.db.run(
      'UPDATE channels SET consecutive_failures = 0, circuit_open_until = NULL, last_success_at = ? WHERE id = ?',
      [now, id],
    );
  }

  recordChannelFailure(id: string, now: number, error: string, circuitOpenUntil: number | null): void {
    this.db.run(
      `UPDATE channels SET consecutive_failures = consecutive_failures + 1, last_error_at = ?, last_error = ?,
         circuit_open_until = COALESCE(?, circuit_open_until) WHERE id = ?`,
      [now, error.slice(0, 1000), circuitOpenUntil, id],
    );
  }

  // ------------------------------------------------------------ routes
  listRoutes(): Route[] {
    return this.db.all<Row>('SELECT * FROM routes ORDER BY position ASC, created_at ASC').map(toRoute);
  }

  getRoute(id: string): Route | undefined {
    const r = this.db.get<Row>('SELECT * FROM routes WHERE id = ?', [id]);
    return r ? toRoute(r) : undefined;
  }

  upsertRoute(r: Omit<Route, 'createdAt' | 'updatedAt'>, now: number): Route {
    this.db.run(
      `INSERT INTO routes (id, name, position, enabled, matchers, channels, delivery, digest_minutes, escalation_policy_id,
         quiet_hours, notify_resolved, stop, created_at, updated_at)
       VALUES (:id, :name, :position, :enabled, :matchers, :channels, :delivery, :digest_minutes, :escalation_policy_id,
         :quiet_hours, :notify_resolved, :stop, :now, :now)
       ON CONFLICT (id) DO UPDATE SET name = excluded.name, position = excluded.position, enabled = excluded.enabled,
         matchers = excluded.matchers, channels = excluded.channels, delivery = excluded.delivery,
         digest_minutes = excluded.digest_minutes, escalation_policy_id = excluded.escalation_policy_id,
         quiet_hours = excluded.quiet_hours, notify_resolved = excluded.notify_resolved, stop = excluded.stop,
         updated_at = excluded.updated_at`,
      {
        id: r.id,
        name: r.name,
        position: r.position,
        enabled: r.enabled,
        matchers: JSON.stringify(r.matchers),
        channels: JSON.stringify(r.channels),
        delivery: r.delivery,
        digest_minutes: r.digestMinutes,
        escalation_policy_id: r.escalationPolicyId,
        quiet_hours: r.quietHours ? JSON.stringify(r.quietHours) : null,
        notify_resolved: r.notifyResolved,
        stop: r.stop,
        now,
      },
    );
    return this.getRoute(r.id)!;
  }

  deleteRoute(id: string): boolean {
    return this.db.run('DELETE FROM routes WHERE id = ?', [id]).changes > 0;
  }

  maxRoutePosition(): number {
    return num(this.db.get<Row>('SELECT COALESCE(MAX(position), -1) AS p FROM routes')!.p);
  }

  // ------------------------------------------------------------ escalation policies
  listPolicies(): EscalationPolicy[] {
    return this.db.all<Row>('SELECT * FROM escalation_policies ORDER BY name').map(toPolicy);
  }

  getPolicy(id: string): EscalationPolicy | undefined {
    const r = this.db.get<Row>('SELECT * FROM escalation_policies WHERE id = ?', [id]);
    return r ? toPolicy(r) : undefined;
  }

  upsertPolicy(p: Omit<EscalationPolicy, 'createdAt' | 'updatedAt'>, now: number): EscalationPolicy {
    this.db.run(
      `INSERT INTO escalation_policies (id, name, steps, repeat, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET name = excluded.name, steps = excluded.steps, repeat = excluded.repeat,
         updated_at = excluded.updated_at`,
      [p.id, p.name, JSON.stringify(p.steps), p.repeat, now, now],
    );
    return this.getPolicy(p.id)!;
  }

  deletePolicy(id: string): boolean {
    return this.db.run('DELETE FROM escalation_policies WHERE id = ?', [id]).changes > 0;
  }

  // ------------------------------------------------------------ silences
  listSilences(activeAt?: number): Silence[] {
    if (activeAt !== undefined) {
      return this.db
        .all<Row>('SELECT * FROM silences WHERE starts_at <= ? AND ends_at > ? ORDER BY ends_at ASC', [activeAt, activeAt])
        .map(toSilence);
    }
    return this.db.all<Row>('SELECT * FROM silences ORDER BY ends_at DESC LIMIT 500').map(toSilence);
  }

  getSilence(id: string): Silence | undefined {
    const r = this.db.get<Row>('SELECT * FROM silences WHERE id = ?', [id]);
    return r ? toSilence(r) : undefined;
  }

  upsertSilence(s: Silence): Silence {
    this.db.run(
      `INSERT INTO silences (id, matchers, starts_at, ends_at, comment, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET matchers = excluded.matchers, starts_at = excluded.starts_at, ends_at = excluded.ends_at,
         comment = excluded.comment`,
      [s.id, JSON.stringify(s.matchers), s.startsAt, s.endsAt, s.comment, s.createdBy, s.createdAt],
    );
    return this.getSilence(s.id)!;
  }

  deleteSilence(id: string): boolean {
    return this.db.run('DELETE FROM silences WHERE id = ?', [id]).changes > 0;
  }

  pruneSilences(before: number): number {
    return this.db.run('DELETE FROM silences WHERE ends_at < ?', [before]).changes;
  }

  // ------------------------------------------------------------ topology
  listDependencies(): ServiceDependency[] {
    return this.db
      .all<Row>('SELECT service, depends_on FROM service_dependencies ORDER BY service, depends_on')
      .map((r) => ({ service: str(r.service), dependsOn: str(r.depends_on) }));
  }

  replaceDependencies(items: ServiceDependency[]): void {
    this.tx(() => {
      this.db.run('DELETE FROM service_dependencies');
      for (const d of items) {
        this.db.run('INSERT OR IGNORE INTO service_dependencies (service, depends_on) VALUES (?, ?)', [d.service, d.dependsOn]);
      }
    });
  }

  // ------------------------------------------------------------ deliveries
  insertDelivery(d: {
    channelId: string;
    incidentId: string | null;
    routeId: string | null;
    kind: NotificationKind;
    message: NotificationMessage;
    now: number;
    dedupeKey: string | null;
  }): number | null {
    const res = this.db.run(
      `INSERT OR IGNORE INTO deliveries (channel_id, incident_id, route_id, kind, message, status, attempts, next_attempt_at,
         created_at, updated_at, dedupe_key)
       VALUES (?, ?, ?, ?, ?, 'pending', 0, ?, ?, ?, ?)`,
      [d.channelId, d.incidentId, d.routeId, d.kind, JSON.stringify(d.message), d.now, d.now, d.now, d.dedupeKey],
    );
    return res.changes > 0 ? res.lastInsertRowid : null;
  }

  getDelivery(id: number): Delivery | undefined {
    const r = this.db.get<Row>('SELECT * FROM deliveries WHERE id = ?', [id]);
    return r ? toDelivery(r) : undefined;
  }

  listDeliveries(f: { status?: DeliveryStatus; channelId?: string; incidentId?: string; limit?: number }): Delivery[] {
    const where: string[] = [];
    const params: SqlValue[] = [];
    if (f.status) {
      where.push('status = ?');
      params.push(f.status);
    }
    if (f.channelId) {
      where.push('channel_id = ?');
      params.push(f.channelId);
    }
    if (f.incidentId) {
      where.push('incident_id = ?');
      params.push(f.incidentId);
    }
    return this.db.raw
      .prepare(`SELECT * FROM deliveries ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id DESC LIMIT ?`)
      .all(...params, Math.min(f.limit ?? 100, 1000))
      .map((r) => toDelivery(r as Row));
  }

  /** Head of every channel queue (FIFO per channel keeps notifications in order). */
  queueHeads(): Delivery[] {
    return this.db
      .all<Row>(
        `SELECT d.* FROM deliveries d
         JOIN (SELECT channel_id, MIN(id) AS id FROM deliveries WHERE status IN ('pending', 'sending') GROUP BY channel_id) h
           ON h.id = d.id`,
      )
      .map(toDelivery);
  }

  markDeliverySending(id: number, now: number): void {
    this.db.run("UPDATE deliveries SET status = 'sending', updated_at = ? WHERE id = ?", [now, id]);
  }

  markDeliverySent(id: number, now: number): void {
    this.db.run(
      "UPDATE deliveries SET status = 'sent', attempts = attempts + 1, sent_at = ?, updated_at = ?, last_error = NULL WHERE id = ?",
      [now, now, id],
    );
  }

  markDeliveryRetry(id: number, now: number, nextAt: number, error: string): void {
    this.db.run(
      "UPDATE deliveries SET status = 'pending', attempts = attempts + 1, next_attempt_at = ?, last_error = ?, updated_at = ? WHERE id = ?",
      [nextAt, error.slice(0, 1000), now, id],
    );
  }

  /** Postpones without counting an attempt (e.g. circuit breaker open). */
  postponeDelivery(id: number, now: number, nextAt: number): void {
    this.db.run("UPDATE deliveries SET status = 'pending', next_attempt_at = ?, updated_at = ? WHERE id = ?", [nextAt, now, id]);
  }

  markDeliveryFailed(id: number, now: number, error: string, countAttempt = true): void {
    this.db.run(
      `UPDATE deliveries SET status = 'failed', attempts = attempts + ?, last_error = ?, updated_at = ? WHERE id = ?`,
      [countAttempt ? 1 : 0, error.slice(0, 1000), now, id],
    );
  }

  resetSendingDeliveries(now: number): number {
    return this.db.run("UPDATE deliveries SET status = 'pending', updated_at = ? WHERE status = 'sending'", [now]).changes;
  }

  retryDelivery(id: number, now: number): boolean {
    return (
      this.db.run(
        "UPDATE deliveries SET status = 'pending', attempts = 0, next_attempt_at = ?, updated_at = ? WHERE id = ? AND status = 'failed'",
        [now, now, id],
      ).changes > 0
    );
  }

  deliveryCounts(): Record<DeliveryStatus, number> {
    const out: Record<DeliveryStatus, number> = { pending: 0, sending: 0, sent: 0, failed: 0 };
    for (const r of this.db.all<Row>('SELECT status, COUNT(*) AS c FROM deliveries GROUP BY status')) {
      out[str(r.status) as DeliveryStatus] = num(r.c);
    }
    return out;
  }

  countSentSince(since: number): number {
    return num(this.db.get<Row>("SELECT COUNT(*) AS c FROM deliveries WHERE status = 'sent' AND sent_at >= ?", [since])!.c);
  }

  sentSeries(since: number, bucketMs: number): Array<{ bucket: number; count: number }> {
    return this.db
      .all<Row>(
        "SELECT CAST(sent_at / ? AS INTEGER) AS bucket, COUNT(*) AS c FROM deliveries WHERE status = 'sent' AND sent_at >= ? GROUP BY bucket",
        [bucketMs, since],
      )
      .map((r) => ({ bucket: num(r.bucket), count: num(r.c) }));
  }

  pruneDeliveries(before: number): number {
    return this.db.run("DELETE FROM deliveries WHERE status IN ('sent', 'failed') AND updated_at < ?", [before]).changes;
  }

  // ------------------------------------------------------------ digests
  insertDigestItem(i: Omit<DigestItem, 'id'>): void {
    this.db.run(
      `INSERT INTO digest_queue (channel_id, route_id, incident_id, kind, created_at, due_at, interval_minutes)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [i.channelId, i.routeId, i.incidentId, i.kind, i.createdAt, i.dueAt, i.intervalMinutes],
    );
  }

  dueDigestChannels(now: number): string[] {
    return this.db
      .all<Row>('SELECT channel_id FROM digest_queue GROUP BY channel_id HAVING MIN(due_at) <= ?', [now])
      .map((r) => str(r.channel_id));
  }

  digestItems(channelId: string): DigestItem[] {
    return this.db
      .all<Row>('SELECT * FROM digest_queue WHERE channel_id = ? ORDER BY id', [channelId])
      .map((r) => ({
        id: num(r.id),
        channelId: str(r.channel_id),
        routeId: strOrNull(r.route_id),
        incidentId: str(r.incident_id),
        kind: str(r.kind) as NotificationKind,
        createdAt: num(r.created_at),
        dueAt: num(r.due_at),
        intervalMinutes: num(r.interval_minutes),
      }));
  }

  hasDigestItem(channelId: string, incidentId: string): boolean {
    return !!this.db.get('SELECT 1 AS x FROM digest_queue WHERE channel_id = ? AND incident_id = ? LIMIT 1', [channelId, incidentId]);
  }

  deleteDigestItems(ids: number[]): void {
    if (ids.length === 0) return;
    this.db.raw.prepare(`DELETE FROM digest_queue WHERE id IN (${placeholders(ids)})`).run(...ids);
  }

  // ------------------------------------------------------------ api keys
  insertApiKey(k: ApiKey & { keyHash: string }): void {
    this.db.run(
      'INSERT INTO api_keys (id, name, key_hash, prefix, scopes, default_source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [k.id, k.name, k.keyHash, k.prefix, JSON.stringify(k.scopes), k.defaultSource, k.createdAt],
    );
  }

  listApiKeys(): ApiKey[] {
    return this.db.all<Row>('SELECT * FROM api_keys ORDER BY created_at DESC').map(toApiKey);
  }

  apiKeyByHash(hash: string): ApiKey | undefined {
    const r = this.db.get<Row>('SELECT * FROM api_keys WHERE key_hash = ?', [hash]);
    return r ? toApiKey(r) : undefined;
  }

  touchApiKey(id: string, now: number): void {
    this.db.run('UPDATE api_keys SET last_used_at = ? WHERE id = ?', [now, id]);
  }

  deleteApiKey(id: string): boolean {
    return this.db.run('DELETE FROM api_keys WHERE id = ?', [id]).changes > 0;
  }
}
