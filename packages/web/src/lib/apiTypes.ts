/**
 * Response shapes of the HTTP API (docs/api.md) that are not domain types.
 * Domain types come from the server package via the `@openrelay/types` alias.
 */
import type {
  Alert,
  ApiKey,
  ApiScope,
  Delivery,
  DeliveryMode,
  DeliveryStatus,
  Incident,
  IncidentLink,
  IncidentStatus,
  NotificationKind,
  ServiceDependency,
  Severity,
  Silence,
  TimelineEntry,
} from '@openrelay/types';

export interface Me {
  name: string;
  scopes: ApiScope[];
  version: string;
  publicUrl: string | null;
}

export interface ListResponse<T> {
  items: T[];
}

export interface PagedResponse<T> {
  items: T[];
  total: number;
}

export interface LinkView extends IncidentLink {
  related: {
    id: string;
    number: number;
    title: string;
    status: IncidentStatus;
    severity: Severity;
    createdAt: number;
    resolvedAt: number | null;
  };
}

export interface IncidentDetail {
  incident: Incident;
  alerts: Alert[];
  timeline: TimelineEntry[];
  links: LinkView[];
  deliveries: Delivery[];
}

export interface SeriesPoint {
  ts: number;
  count: number;
}

export interface Stats {
  incidents: {
    open: number;
    acknowledged: number;
    resolved: number;
    bySeverity: Partial<Record<Severity, number>>;
  };
  totals: { events: number; alerts: number; incidents: number; notifications: number };
  /** Share of events that did not lead to a notification (0..1). */
  noiseReduction: number | null;
  eventsSeries: SeriesPoint[];
  notificationsSeries: SeriesPoint[];
  /** Bucket width of the series (not in docs/api.md; derived from the timestamps when missing). */
  bucketMinutes?: number;
  mttaMinutes: number | null;
  mttrMinutes: number | null;
  topSources: { source: string; count: number }[];
  queue: { pending: number; failed: number };
}

export type ConfigFieldType = 'string' | 'secret' | 'number' | 'boolean' | 'select' | 'text';

export interface ConfigField {
  key: string;
  label: string;
  type: ConfigFieldType;
  required?: boolean;
  placeholder?: string;
  help?: string;
  options?: { value: string; label: string }[];
  default?: unknown;
}

export interface ChannelTypeInfo {
  type: string;
  displayName: string;
  description: string;
  configSchema: ConfigField[];
}

export interface PluginsInfo {
  channels: ChannelTypeInfo[];
  adapters: { name: string; description: string }[];
  plugins: { name: string; version: string; builtin: boolean }[];
}

export interface SimulationCondition {
  expr: string;
  matched: boolean;
}

export interface SimulationRoute {
  routeId: string;
  name: string;
  matched: boolean;
  mode: DeliveryMode | string | null;
  conditions: SimulationCondition[];
  // Optional extras (not in docs/api.md, shown when the server sends them):
  enabled?: boolean;
  /** Delivery deferred because the route's quiet hours are active. */
  quietHours?: boolean;
  channels?: string[];
  escalationPolicyId?: string | null;
}

export interface SimulationResult {
  context: Record<string, unknown>;
  /** Silence that would suppress the notification (object or id), null when none matches. */
  silencedBy: (Partial<Silence> & { id: string }) | string | null;
  routes: SimulationRoute[];
  /** Event would be dropped by an event rule (optional extra). */
  dropped?: boolean;
}

/** Payload of the SSE `delivery` event. */
export interface DeliveryEvent {
  id: number;
  status: DeliveryStatus;
  channelId: string;
  incidentId: string | null;
  kind: NotificationKind;
}

export interface TopologyResponse {
  items: ServiceDependency[];
  services: string[];
}

export interface ApiKeyCreated {
  apiKey: ApiKey;
  token: string;
}
