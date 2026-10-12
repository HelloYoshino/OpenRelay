# OpenRelay HTTP-API (v1)

Basis-URL: `http://<host>:8080/api/v1` · Alle Zeitstempel sind **Unix-Millisekunden**.
Die Domänentypen (`Incident`, `Alert`, `Route`, …) sind in
[`packages/server/src/types.ts`](../packages/server/src/types.ts) definiert.

## Authentifizierung

Jede Anfrage (außer `/healthz` und den signierten Bestätigungslinks) braucht ein Token:

| Variante | Beispiel |
| --- | --- |
| Header | `Authorization: Bearer or_xxx` |
| Header | `X-OpenRelay-Token: or_xxx` |
| Query | `?token=or_xxx` (für Webhooks, z. B. GitHub, und für SSE) |

Tokens:

* **Admin-Token** – aus `OPENRELAY_ADMIN_TOKEN` oder beim ersten Start generiert (steht im Log). Vollzugriff.
* **API-Keys** – im Dashboard erstellt, mit Scopes `ingest` (nur Ereignisse senden), `read` (lesen), `admin` (alles).

Fehlerantworten haben die Form `{ "error": "Beschreibung" }` mit passendem Statuscode
(400 Validierung, 401 kein/ungültiges Token, 403 Scope fehlt, 404 nicht gefunden).

## Ereignisse senden (Scope `ingest`)

### `POST /api/v1/events`

Body: ein `EventInput`, ein Array davon oder `{ "events": [...] }`.

```json
{
  "title": "Datenbank nicht erreichbar",
  "source": "delta-ai",
  "severity": "critical",
  "service": "api",
  "host": "srv-01",
  "message": "ECONNREFUSED 10.0.0.5:5432",
  "labels": { "env": "prod" },
  "correlationKey": "deploy-2026-10-12",
  "status": "firing"
}
```

Felder: `title` (Pflicht), `source`, `message`, `severity` (`debug|info|warning|high|critical`, Standard `warning`),
`status` (`firing|resolved`), `type`, `service`, `host`, `fingerprint`, `correlationKey`, `labels`, `url`,
`timestamp`, `ttl` (Sekunden bis zur automatischen Auflösung, `0` = nie), `payload`.

Antwort `202`:

```json
{ "accepted": 1, "results": [ { "eventId": "evt_…", "alertId": "alr_…", "incidentId": "inc_…", "action": "created" } ] }
```

`action`: `created | deduplicated | reopened | resolved | ignored | dropped`.

### `POST /api/v1/ingest/:adapter`

Webhook-Adapter übersetzen fremde Formate: `generic`, `text`, `alertmanager`, `grafana`, `github`, `gitlab`,
`uptime-kuma` (+ Adapter aus Plugins). Gemeinsame Query-Parameter überschreiben Felder:
`source`, `severity`, `service`, `host`, `labels` (`k=v,k2=v2`).

`text`-Adapter (ideal für Shell-Skripte): `curl -d "Backup fehlgeschlagen" "http://relay:8080/api/v1/ingest/text?source=backup&severity=high&token=…"`.
Erste Zeile = Titel, Rest = Nachricht. Header `X-Title`, `X-Severity`, `X-Service`, `X-Tags` werden ebenfalls ausgewertet.

## Vorfälle (Scope `read`, Aktionen `admin`)

| Methode & Pfad | Beschreibung |
| --- | --- |
| `GET /incidents?status=open,acknowledged&severity=critical&q=text&limit=50&offset=0` | `{ items: Incident[], total }` (neueste Aktivität zuerst) |
| `GET /incidents/:id` | `{ incident, alerts: Alert[], timeline: TimelineEntry[], links: LinkView[], deliveries: Delivery[] }` |
| `POST /incidents/:id/ack` `{ actor? }` | Bestätigen, stoppt Eskalation → `{ incident }` |
| `POST /incidents/:id/resolve` `{ actor?, note? }` | Auflösen → `{ incident }` |
| `POST /incidents/:id/reopen` `{ actor? }` | Wieder öffnen → `{ incident }` |
| `POST /incidents/:id/comment` `{ text, actor? }` | Kommentar → `{ entry: TimelineEntry }` |
| `POST /incidents/:id/merge` `{ targetId, actor? }` | In anderen Vorfall zusammenführen (lernt die Verknüpfung) → `{ incident }` (Ziel) |
| `POST /alerts/:id/detach` `{ actor? }` | Alarm abtrennen → neuer Vorfall (lernt die Trennung) → `{ incident }` |
| `GET /alerts?status=firing&incidentId=…&limit=100` | `{ items: Alert[], total }` |
| `GET /events?q=&source=&severity=&alertId=&incidentId=&before=<ts>&limit=100` | `{ items: StoredEvent[] }` (neueste zuerst) |

`LinkView` = `IncidentLink & { related: { id, number, title, status, severity, createdAt, resolvedAt } }`.

## Konfiguration (Scope `admin`, `GET` auch `read`)

| Ressource | Endpunkte |
| --- | --- |
| Kanäle | `GET/POST /channels`, `PUT/DELETE /channels/:id`, `POST /channels/:id/test` |
| Routing-Regeln | `GET/POST /routes`, `PUT/DELETE /routes/:id`, `POST /routes/simulate` |
| Eskalationsrichtlinien | `GET/POST /escalation-policies`, `PUT/DELETE /escalation-policies/:id` |
| Stummschaltungen | `GET /silences?active=true`, `POST /silences`, `PUT/DELETE /silences/:id` |
| Service-Topologie | `GET /topology` → `{ items: ServiceDependency[], services: string[] }`, `PUT /topology` `{ items }` |
| Engine-Einstellungen | `GET /settings` → `{ settings }`, `PUT /settings` `{ settings: Partial<EngineSettings> }` |
| API-Keys | `GET/POST /api-keys` (POST → `{ apiKey, token }`, Token nur einmal sichtbar), `DELETE /api-keys/:id` |
| Zustellungen | `GET /deliveries?status=failed&channelId=&limit=`, `POST /deliveries/:id/retry` |
| Plugins | `GET /plugins` → `{ channels: ChannelTypeInfo[], adapters: {name, description}[], plugins: {name, version, builtin}[] }` |
| Import/Export | `GET /config/export` (YAML), `POST /config/import` (YAML oder JSON) |

Listen-Endpunkte antworten mit `{ items: [...] }`, Einzel-Endpunkte mit `{ channel }`, `{ route }`, `{ policy }`, `{ silence }`.

`ChannelTypeInfo` = `{ type, displayName, description, configSchema: ConfigField[] }`,
`ConfigField` = `{ key, label, type: 'string'|'secret'|'number'|'boolean'|'select'|'text', required?, placeholder?, help?, options?: {value,label}[], default? }`.
Geheime Felder werden in Antworten als `"••••••"` maskiert; wird dieser Wert unverändert zurückgeschickt, bleibt der gespeicherte Wert erhalten.

### Routing-Simulator

`POST /routes/simulate` `{ "event": EventInput }` →

```json
{
  "context": { "severity": "critical", "source": "github", "labels.env": "prod" },
  "silencedBy": null,
  "routes": [
    { "routeId": "rt_1", "name": "Kritisch → Telegram", "matched": true, "mode": "immediate",
      "conditions": [ { "expr": "severity >= high", "matched": true } ] }
  ]
}
```

### Matcher-Syntax

Bedingungen sind Strings `<feld> <operator> <wert>`; alle Bedingungen einer Regel müssen zutreffen.

* Felder: `severity`, `status`, `priority`, `source`, `type`, `title`, `message`, `service`, `host`, `correlationKey`, `labels.<name>`
  (bei Vorfällen zusätzlich `services`, `sources` – trifft zu, wenn ein Element passt)
* Operatoren: `=` (mit `*`-Wildcards), `!=`, `=~` (Regex), `!~`, `>=`, `>`, `<=`, `<` (für `severity` nach Schweregrad, sonst numerisch), `in [a, b]`, `not in [a, b]`, `exists`, `missing`
* Beispiele: `severity >= high`, `labels.env = prod`, `service =~ ^api-`, `source in [github, gitlab]`, `host = web-*`

## Statistik & Live-Daten

* `GET /stats?hours=24` →
  `{ incidents: { open, acknowledged, resolved, bySeverity }, totals: { events, alerts, incidents, notifications }, noiseReduction, eventsSeries: [{ ts, count }], notificationsSeries: [{ ts, count }], mttaMinutes, mttrMinutes, topSources: [{ source, count }], queue: { pending, failed } }`
* `GET /stream?token=…` – Server-Sent Events: `incident` (Incident), `alert` (Alert), `delivery` (`{ id, status, channelId, incidentId, kind }`), alle 25 s ein Ping-Kommentar.
* `GET /me` → `{ name, scopes, version, publicUrl }`
* `GET /healthz` (ohne Auth) → `{ status: "ok", version, uptimeSeconds }`
* `GET /metrics` (Prometheus-Format, Scope `read`)

## Signierte Links

Benachrichtigungen enthalten Links `/a/:incidentId/ack?sig=…` bzw. `/a/:incidentId/resolve?sig=…`.
`GET` zeigt eine Bestätigungsseite (damit Link-Vorschauen von Chat-Apps nichts auslösen), `POST` führt die Aktion aus
(z. B. ntfy-Aktionsbuttons).
