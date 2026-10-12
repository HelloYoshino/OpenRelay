/**
 * Core domain types of OpenRelay.
 *
 * Processing chain:  Event  ->  Alert (deduplicated by fingerprint)  ->  Incident (correlated alerts)
 * All timestamps are Unix epoch milliseconds.
 */

export const SEVERITIES = ['debug', 'info', 'warning', 'high', 'critical'] as const;
export type Severity = (typeof SEVERITIES)[number];

export type EventStatus = 'firing' | 'resolved';
export type AlertStatus = 'firing' | 'resolved';
export type IncidentStatus = 'open' | 'acknowledged' | 'resolved';

/** What the pipeline did with an incoming event. */
export type EventAction =
  | 'created' // first event of a new alert
  | 'deduplicated' // folded into an existing firing alert
  | 'reopened' // re-fired a recently resolved alert
  | 'resolved' // resolved a firing alert
  | 'ignored' // resolve for an unknown/already resolved alert
  | 'dropped'; // removed by an event rule or processor plugin

/** Event as accepted by the ingestion API (after adapter translation). */
export interface EventInput {
  title: string;
  source?: string;
  message?: string;
  severity?: Severity;
  status?: EventStatus;
  type?: string;
  service?: string;
  host?: string;
  /** Custom deduplication key. Computed from source/service/host/type/title when omitted. */
  fingerprint?: string;
  /** Explicit grouping key: events sharing it always end up in the same incident (e.g. a deployment or trace id). */
  correlationKey?: string;
  labels?: Record<string, string>;
  url?: string;
  /** ISO-8601 string or epoch milliseconds. */
  timestamp?: string | number;
  /** Seconds without new events until the alert auto-resolves. 0 = never. Defaults to the global setting. */
  ttl?: number;
  payload?: unknown;
}

/** Normalized event as it flows through the pipeline. */
export interface NormalizedEvent {
  title: string;
  source: string;
  message: string | null;
  severity: Severity;
  status: EventStatus;
  type: string | null;
  service: string | null;
  host: string | null;
  fingerprint: string;
  correlationKey: string | null;
  labels: Record<string, string>;
  url: string | null;
  occurredAt: number;
  ttl: number | null;
  payload: unknown;
}

export interface StoredEvent extends NormalizedEvent {
  id: string;
  receivedAt: number;
  alertId: string | null;
  incidentId: string | null;
  action: EventAction;
}

export interface Alert {
  id: string;
  fingerprint: string;
  source: string;
  type: string | null;
  title: string;
  message: string | null;
  severity: Severity;
  /** Severity of the first event (before volume escalation). */
  baseSeverity: Severity;
  status: AlertStatus;
  service: string | null;
  host: string | null;
  correlationKey: string | null;
  labels: Record<string, string>;
  url: string | null;
  firstSeen: number;
  lastSeen: number;
  resolvedAt: number | null;
  /** Number of events folded into this alert. */
  count: number;
  incidentId: string | null;
  ttl: number | null;
  flapping: boolean;
  /** Timestamps of recent firing/resolved transitions (flap detection). */
  stateChanges: number[];
}

export interface Incident {
  id: string;
  /** Human friendly, monotonically increasing number (#42). */
  number: number;
  title: string;
  status: IncidentStatus;
  severity: Severity;
  /** 1 (highest) .. 5 (lowest) */
  priority: number;
  createdAt: number;
  updatedAt: number;
  lastActivityAt: number;
  acknowledgedAt: number | null;
  acknowledgedBy: string | null;
  resolvedAt: number | null;
  resolvedBy: string | null;
  rootAlertId: string | null;
  rootFingerprint: string | null;
  /** Explanation why the root alert is considered the probable cause. */
  rootReason: string | null;
  services: string[];
  sources: string[];
  /** Labels shared by all alerts of the incident. */
  labels: Record<string, string>;
  correlationKey: string | null;
  alertCount: number;
  firingCount: number;
  eventCount: number;
  /** Incident created by storm detection (many unrelated alerts at once). */
  storm: boolean;
  /** How often the same root problem occurred before (lookback window). */
  recurrenceCount: number;
  notifyState: 'pending' | 'notified' | 'suppressed' | 'none';
  notifiedSeverity: Severity | null;
  notifiedChannels: string[];
  escalationPolicyId: string | null;
  escalationStep: number;
  escalationCycle: number;
  escalationNextAt: number | null;
}

export type TimelineKind =
  | 'created'
  | 'alert_added'
  | 'alert_resolved'
  | 'alert_reopened'
  | 'alert_detached'
  | 'severity_changed'
  | 'flapping'
  | 'notified'
  | 'digest_queued'
  | 'suppressed'
  | 'unrouted'
  | 'escalated'
  | 'acknowledged'
  | 'resolved'
  | 'reopened'
  | 'merged'
  | 'linked'
  | 'comment';

export interface TimelineEntry {
  id: number;
  incidentId: string;
  ts: number;
  kind: TimelineKind;
  message: string;
  actor: string | null;
  data: Record<string, unknown> | null;
}

export type IncidentLinkKind = 'related' | 'recurrence' | 'merged';

export interface IncidentLink {
  incidentId: string;
  relatedId: string;
  kind: IncidentLinkKind;
  score: number | null;
  reason: string | null;
  createdAt: number;
}

export interface Channel {
  id: string;
  name: string;
  /** Channel plugin type, e.g. "discord". */
  type: string;
  config: Record<string, unknown>;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
  consecutiveFailures: number;
  circuitOpenUntil: number | null;
  lastSuccessAt: number | null;
  lastErrorAt: number | null;
  lastError: string | null;
}

export type DeliveryMode = 'auto' | 'immediate' | 'digest';

export interface QuietHours {
  /** "HH:MM" local time */
  start: string;
  end: string;
  /** IANA time zone, defaults to the server time zone. */
  timezone?: string;
  /** Severities at or above this level ignore quiet hours. Default: critical. */
  bypassSeverity?: Severity;
}

export interface Route {
  id: string;
  name: string;
  position: number;
  enabled: boolean;
  /** All conditions must match, e.g. ["severity >= high", "labels.env = prod"]. Empty = match everything. */
  matchers: string[];
  channels: string[];
  delivery: DeliveryMode;
  /** Digest interval for this route; falls back to the global setting. */
  digestMinutes: number | null;
  escalationPolicyId: string | null;
  quietHours: QuietHours | null;
  notifyResolved: boolean;
  /** Stop evaluating further routes when this one matched. */
  stop: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface EscalationStep {
  /** Minutes after the previous step (or the initial notification) without acknowledgement. */
  delayMinutes: number;
  channels: string[];
}

export interface EscalationPolicy {
  id: string;
  name: string;
  steps: EscalationStep[];
  /** How often the whole chain is repeated after the last step. */
  repeat: number;
  createdAt: number;
  updatedAt: number;
}

export interface Silence {
  id: string;
  matchers: string[];
  startsAt: number;
  endsAt: number;
  comment: string | null;
  createdBy: string | null;
  createdAt: number;
}

export interface ServiceDependency {
  service: string;
  dependsOn: string;
}

export type DeliveryStatus = 'pending' | 'sending' | 'sent' | 'failed';

export type NotificationKind =
  | 'incident.opened'
  | 'incident.reopened'
  | 'incident.severity'
  | 'incident.escalated'
  | 'incident.resolved'
  | 'digest'
  | 'test';

export interface Delivery {
  id: number;
  channelId: string;
  incidentId: string | null;
  routeId: string | null;
  kind: NotificationKind;
  message: NotificationMessage;
  status: DeliveryStatus;
  attempts: number;
  nextAttemptAt: number;
  lastError: string | null;
  createdAt: number;
  updatedAt: number;
  sentAt: number | null;
}

export interface NotificationField {
  name: string;
  value: string;
}

export interface NotificationItem {
  incidentId: string;
  number: number;
  title: string;
  severity: Severity;
  status: IncidentStatus;
  alertCount: number;
  eventCount: number;
  url: string;
}

/** Channel-agnostic notification. Channel plugins render it for their target. */
export interface NotificationMessage {
  kind: NotificationKind;
  /** Short headline incl. emoji and priority prefix. */
  title: string;
  /** Plain-text body (multi-line). */
  text: string;
  severity: Severity;
  priority: number;
  status: IncidentStatus | null;
  timestamp: number;
  /** Link to the dashboard. */
  url: string | null;
  /** Signed link that acknowledges the incident (opens a confirmation page on GET, acts on POST). */
  ackUrl: string | null;
  resolveUrl: string | null;
  incident: {
    id: string;
    number: number;
    title: string;
    alertCount: number;
    eventCount: number;
    services: string[];
    sources: string[];
    rootCause: string | null;
    sourceUrl: string | null;
  } | null;
  fields: NotificationField[];
  /** Digest entries. */
  items: NotificationItem[];
  escalationStep: number | null;
}

export type ApiScope = 'ingest' | 'read' | 'admin';

export interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  scopes: ApiScope[];
  /** Source used for events that don't declare one. */
  defaultSource: string | null;
  createdAt: number;
  lastUsedAt: number | null;
}

export interface VolumeRule {
  name: string;
  matchers: string[];
  /** Number of events of one alert ... */
  count: number;
  /** ... within this many minutes ... */
  windowMinutes: number;
  /** ... raises the alert to this severity. */
  raiseTo: Severity;
}

export interface EventRule {
  name: string;
  matchers: string[];
  /** Drop matching events entirely. */
  drop?: boolean;
  set?: {
    severity?: Severity;
    service?: string;
    host?: string;
    correlationKey?: string;
    labels?: Record<string, string>;
  };
}

export interface EngineSettings {
  locale: 'de' | 'en';
  dedup: {
    /** A resolved alert that fires again within this window is re-opened instead of re-created. */
    reopenWindowMinutes: number;
    /** Alerts without resolve events auto-resolve after this many minutes of silence. 0 = never. */
    autoResolveMinutes: number;
  };
  correlation: {
    enabled: boolean;
    /** Max minutes since the last activity of an incident to attach new alerts to it. */
    windowMinutes: number;
    /** Score needed to attach an alert to an incident. */
    threshold: number;
    /** Score needed to link a new incident as "related". */
    relatedThreshold: number;
    /** Labels whose equal values hint at a relation. */
    groupByLabels: string[];
    weights: {
      learned: number;
      topology: number;
      service: number;
      host: number;
      label: number;
      similarity: number;
      source: number;
    };
  };
  flapping: {
    enabled: boolean;
    windowMinutes: number;
    /** State changes within the window that mark an alert as flapping. */
    threshold: number;
  };
  storm: {
    enabled: boolean;
    windowSeconds: number;
    /** New alerts within the window that trigger storm mode. */
    threshold: number;
  };
  notifications: {
    /** With delivery mode "auto": severities at or above are sent immediately, the rest is collected in digests. */
    immediateSeverity: Severity;
    digestMinutes: number;
    /** Critical incidents skip digests even on digest-only routes. */
    criticalBypassDigest: boolean;
  };
  priority: {
    /** Incidents spanning at least this many services get one priority level higher. 0 disables. */
    wideImpactServices: number;
  };
  recurrence: {
    lookbackDays: number;
  };
  retention: {
    eventsDays: number;
    resolvedIncidentsDays: number;
    deliveriesDays: number;
  };
  volumeRules: VolumeRule[];
  eventRules: EventRule[];
}

export interface IngestResult {
  eventId: string | null;
  alertId: string | null;
  incidentId: string | null;
  action: EventAction;
}
