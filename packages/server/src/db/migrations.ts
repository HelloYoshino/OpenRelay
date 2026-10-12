/** Append-only list of schema migrations. Never edit an entry that has been released. */
export const MIGRATIONS: string[] = [
  `
  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE events (
    id TEXT PRIMARY KEY,
    received_at INTEGER NOT NULL,
    occurred_at INTEGER NOT NULL,
    source TEXT NOT NULL,
    type TEXT,
    title TEXT NOT NULL,
    message TEXT,
    severity TEXT NOT NULL,
    status TEXT NOT NULL,
    service TEXT,
    host TEXT,
    fingerprint TEXT NOT NULL,
    correlation_key TEXT,
    labels TEXT NOT NULL DEFAULT '{}',
    url TEXT,
    ttl INTEGER,
    payload TEXT,
    alert_id TEXT,
    incident_id TEXT,
    action TEXT NOT NULL
  );
  CREATE INDEX idx_events_received ON events (received_at);
  CREATE INDEX idx_events_alert ON events (alert_id, received_at);
  CREATE INDEX idx_events_incident ON events (incident_id, received_at);

  CREATE TABLE alerts (
    id TEXT PRIMARY KEY,
    fingerprint TEXT NOT NULL,
    source TEXT NOT NULL,
    type TEXT,
    title TEXT NOT NULL,
    message TEXT,
    severity TEXT NOT NULL,
    base_severity TEXT NOT NULL,
    status TEXT NOT NULL,
    service TEXT,
    host TEXT,
    correlation_key TEXT,
    labels TEXT NOT NULL DEFAULT '{}',
    url TEXT,
    first_seen INTEGER NOT NULL,
    last_seen INTEGER NOT NULL,
    resolved_at INTEGER,
    count INTEGER NOT NULL DEFAULT 1,
    incident_id TEXT,
    ttl INTEGER,
    flapping INTEGER NOT NULL DEFAULT 0,
    state_changes TEXT NOT NULL DEFAULT '[]'
  );
  CREATE INDEX idx_alerts_fingerprint ON alerts (fingerprint, last_seen);
  CREATE INDEX idx_alerts_incident ON alerts (incident_id, first_seen);
  CREATE INDEX idx_alerts_status ON alerts (status, last_seen);
  CREATE INDEX idx_alerts_first_seen ON alerts (first_seen);

  CREATE TABLE incidents (
    id TEXT PRIMARY KEY,
    number INTEGER NOT NULL UNIQUE,
    title TEXT NOT NULL,
    status TEXT NOT NULL,
    severity TEXT NOT NULL,
    priority INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    last_activity_at INTEGER NOT NULL,
    acknowledged_at INTEGER,
    acknowledged_by TEXT,
    resolved_at INTEGER,
    resolved_by TEXT,
    root_alert_id TEXT,
    root_fingerprint TEXT,
    root_reason TEXT,
    services TEXT NOT NULL DEFAULT '[]',
    sources TEXT NOT NULL DEFAULT '[]',
    labels TEXT NOT NULL DEFAULT '{}',
    correlation_key TEXT,
    alert_count INTEGER NOT NULL DEFAULT 0,
    firing_count INTEGER NOT NULL DEFAULT 0,
    event_count INTEGER NOT NULL DEFAULT 0,
    storm INTEGER NOT NULL DEFAULT 0,
    recurrence_count INTEGER NOT NULL DEFAULT 0,
    notify_state TEXT NOT NULL DEFAULT 'pending',
    notified_severity TEXT,
    notified_channels TEXT NOT NULL DEFAULT '[]',
    escalation_policy_id TEXT,
    escalation_step INTEGER NOT NULL DEFAULT 0,
    escalation_cycle INTEGER NOT NULL DEFAULT 0,
    escalation_next_at INTEGER
  );
  CREATE INDEX idx_incidents_status ON incidents (status, last_activity_at);
  CREATE INDEX idx_incidents_escalation ON incidents (escalation_next_at);
  CREATE INDEX idx_incidents_root ON incidents (root_fingerprint, resolved_at);
  CREATE INDEX idx_incidents_created ON incidents (created_at);
  CREATE INDEX idx_incidents_key ON incidents (correlation_key);

  CREATE TABLE incident_timeline (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    incident_id TEXT NOT NULL,
    ts INTEGER NOT NULL,
    kind TEXT NOT NULL,
    message TEXT NOT NULL,
    actor TEXT,
    data TEXT
  );
  CREATE INDEX idx_timeline_incident ON incident_timeline (incident_id, id);

  CREATE TABLE incident_links (
    incident_id TEXT NOT NULL,
    related_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    score REAL,
    reason TEXT,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (incident_id, related_id, kind)
  );
  CREATE INDEX idx_links_related ON incident_links (related_id);

  CREATE TABLE learned_correlations (
    fp_a TEXT NOT NULL,
    fp_b TEXT NOT NULL,
    weight INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    origin TEXT,
    PRIMARY KEY (fp_a, fp_b)
  );

  CREATE TABLE channels (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    config TEXT NOT NULL DEFAULT '{}',
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    consecutive_failures INTEGER NOT NULL DEFAULT 0,
    circuit_open_until INTEGER,
    last_success_at INTEGER,
    last_error_at INTEGER,
    last_error TEXT
  );

  CREATE TABLE routes (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    enabled INTEGER NOT NULL DEFAULT 1,
    matchers TEXT NOT NULL DEFAULT '[]',
    channels TEXT NOT NULL DEFAULT '[]',
    delivery TEXT NOT NULL DEFAULT 'auto',
    digest_minutes INTEGER,
    escalation_policy_id TEXT,
    quiet_hours TEXT,
    notify_resolved INTEGER NOT NULL DEFAULT 1,
    stop INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE escalation_policies (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    steps TEXT NOT NULL DEFAULT '[]',
    repeat INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE silences (
    id TEXT PRIMARY KEY,
    matchers TEXT NOT NULL DEFAULT '[]',
    starts_at INTEGER NOT NULL,
    ends_at INTEGER NOT NULL,
    comment TEXT,
    created_by TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX idx_silences_ends ON silences (ends_at);

  CREATE TABLE service_dependencies (
    service TEXT NOT NULL,
    depends_on TEXT NOT NULL,
    PRIMARY KEY (service, depends_on)
  );

  CREATE TABLE deliveries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    channel_id TEXT NOT NULL,
    incident_id TEXT,
    route_id TEXT,
    kind TEXT NOT NULL,
    message TEXT NOT NULL,
    status TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at INTEGER NOT NULL,
    last_error TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    sent_at INTEGER,
    dedupe_key TEXT UNIQUE
  );
  CREATE INDEX idx_deliveries_queue ON deliveries (status, channel_id, id);
  CREATE INDEX idx_deliveries_incident ON deliveries (incident_id);
  CREATE INDEX idx_deliveries_created ON deliveries (created_at);

  CREATE TABLE digest_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    channel_id TEXT NOT NULL,
    route_id TEXT,
    incident_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    due_at INTEGER NOT NULL,
    interval_minutes INTEGER NOT NULL
  );
  CREATE INDEX idx_digest_channel ON digest_queue (channel_id, due_at);

  CREATE TABLE api_keys (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    key_hash TEXT NOT NULL UNIQUE,
    prefix TEXT NOT NULL,
    scopes TEXT NOT NULL,
    default_source TEXT,
    created_at INTEGER NOT NULL,
    last_used_at INTEGER
  );
  `,
];
