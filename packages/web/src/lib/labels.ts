import type {
  ApiScope,
  DeliveryMode,
  DeliveryStatus,
  EventAction,
  IncidentLinkKind,
  IncidentStatus,
  NotificationKind,
  Severity,
  TimelineKind,
} from '@openrelay/types';

/** Ordered from most to least severe. */
export const SEVERITY_ORDER: Severity[] = ['critical', 'high', 'warning', 'info', 'debug'];

export const SEVERITY_RANK: Record<Severity, number> = {
  critical: 4,
  high: 3,
  warning: 2,
  info: 1,
  debug: 0,
};

export const SEVERITY_LABEL: Record<Severity, string> = {
  critical: 'Kritisch',
  high: 'Hoch',
  warning: 'Warnung',
  info: 'Info',
  debug: 'Debug',
};

export const STATUS_LABEL: Record<IncidentStatus, string> = {
  open: 'Offen',
  acknowledged: 'Bestätigt',
  resolved: 'Gelöst',
};

export const ALERT_STATUS_LABEL: Record<'firing' | 'resolved', string> = {
  firing: 'Aktiv',
  resolved: 'Gelöst',
};

export const EVENT_ACTION_LABEL: Record<EventAction, string> = {
  created: 'neu',
  deduplicated: 'dedupliziert',
  reopened: 'wiedereröffnet',
  resolved: 'aufgelöst',
  ignored: 'ignoriert',
  dropped: 'verworfen',
};

export const DELIVERY_STATUS_LABEL: Record<DeliveryStatus, string> = {
  pending: 'wartend',
  sending: 'sendet',
  sent: 'gesendet',
  failed: 'fehlgeschlagen',
};

export const NOTIFICATION_KIND_LABEL: Record<NotificationKind, string> = {
  'incident.opened': 'Eröffnet',
  'incident.reopened': 'Wiedereröffnet',
  'incident.severity': 'Schweregrad',
  'incident.escalated': 'Eskalation',
  'incident.resolved': 'Gelöst',
  digest: 'Digest',
  test: 'Test',
};

export const LINK_KIND_LABEL: Record<IncidentLinkKind, string> = {
  related: 'verwandt',
  recurrence: 'wiederkehrend',
  merged: 'zusammengeführt',
};

export const DELIVERY_MODE_LABEL: Record<DeliveryMode, string> = {
  auto: 'Automatisch (nach Schweregrad)',
  immediate: 'Sofort',
  digest: 'Sammeln (Digest)',
};

export const SCOPE_LABEL: Record<ApiScope, string> = {
  ingest: 'ingest – Ereignisse senden',
  read: 'read – lesen',
  admin: 'admin – alles',
};

export const TIMELINE_LABEL: Record<TimelineKind, string> = {
  created: 'Erstellt',
  alert_added: 'Alarm hinzugefügt',
  alert_resolved: 'Alarm gelöst',
  alert_reopened: 'Alarm wieder aktiv',
  alert_detached: 'Alarm abgetrennt',
  severity_changed: 'Schweregrad geändert',
  flapping: 'Flattern',
  notified: 'Benachrichtigt',
  digest_queued: 'Für Digest vorgemerkt',
  suppressed: 'Unterdrückt',
  unrouted: 'Keine Route',
  escalated: 'Eskaliert',
  acknowledged: 'Bestätigt',
  resolved: 'Gelöst',
  reopened: 'Wieder geöffnet',
  merged: 'Zusammengeführt',
  linked: 'Verknüpft',
  comment: 'Kommentar',
};

export function labelOf<K extends string>(map: Record<K, string>, key: string | null | undefined): string {
  if (key === null || key === undefined) return '–';
  return (map as Record<string, string>)[key] ?? key;
}

export function deliveryModeLabel(mode: string | null | undefined): string {
  if (!mode) return '–';
  return labelOf(DELIVERY_MODE_LABEL, mode);
}
