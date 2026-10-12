# Plugins entwickeln

OpenRelay lädt beim Start jede `*.js`/`*.mjs`-Datei und jedes Paketverzeichnis (mit `package.json` oder `index.js`)
aus `$OPENRELAY_PLUGIN_DIR` (Standard: `$OPENRELAY_DATA_DIR/plugins`, im Container `/data/plugins`).
Ein fehlerhaftes Plugin wird geloggt und übersprungen, der Server läuft weiter.

## Aufbau

Der Default-Export ist entweder ein Plugin-Objekt oder eine Factory, die das Objekt zurückgibt:

```js
export default (api) => ({
  name: 'mein-plugin',        // Pflicht
  version: '1.0.0',
  channels: [/* ChannelPlugin */],
  adapters: [/* IngestAdapter */],
  processors: [/* EventProcessor */],
});
```

`api` enthält `logger`, `publicUrl`, `version` sowie die Helfer `httpRequest`, `DeliveryError` und `AdapterError`.
Plugins brauchen deshalb keine Abhängigkeiten. TypeScript-Typen stehen in
[`packages/server/src/plugins/types.ts`](../packages/server/src/plugins/types.ts) (Export `@openrelay/server/plugin`).

## Kanäle

```js
{
  type: 'my-pager',                 // eindeutige Typ-ID
  displayName: 'Mein Pager',
  description: 'Erscheint im Dashboard',
  configSchema: [
    { key: 'url', label: 'URL', type: 'string', required: true },
    { key: 'token', label: 'Token', type: 'secret' },          // wird maskiert
    { key: 'loud', label: 'Laut', type: 'boolean', default: false },
    { key: 'mode', label: 'Modus', type: 'select', options: [{ value: 'a', label: 'A' }] },
  ],
  validate(config) { return config.url.startsWith('https://') ? [] : ['Nur https'] },
  async send(message, config, ctx) {
    await api.httpRequest(config.url, { body: { text: message.title }, signal: ctx.signal });
  },
}
```

`message` ist eine `NotificationMessage`:

| Feld | Inhalt |
| --- | --- |
| `kind` | `incident.opened`, `incident.reopened`, `incident.severity`, `incident.escalated`, `incident.resolved`, `digest`, `test` |
| `title`, `text` | fertig formulierte Überschrift (mit Emoji und Priorität) und Text |
| `severity`, `priority`, `status` | Schweregrad, P1–P5, Status des Vorfalls |
| `fields` | Schlüssel/Wert-Paare (Services, Quellen, Ursache …) |
| `url`, `ackUrl`, `resolveUrl` | Dashboard-Link und signierte Aktions-Links (POST führt aus) |
| `incident` | Kurzinfo zum Vorfall (`number`, `alertCount`, `eventCount`, `services`, `rootCause`, `sourceUrl`) |
| `items` | Einträge einer Zusammenfassung (`digest`) |

**Fehler & Wiederholungen:** Wirf `new api.DeliveryError(text, retryable, retryAfterMs)`. `httpRequest` erledigt das
automatisch: 429/5xx/Netzwerkfehler werden wiederholt (inkl. `Retry-After`), andere 4xx sind endgültig. Jede andere
Exception gilt als wiederholbar. Zustellungen werden pro Kanal in Reihenfolge gesendet. Nach 5 Fehlern in Folge
pausiert der Kanal (Circuit-Breaker).

## Adapter

Adapter übersetzen fremde Webhooks in Ereignisse und sind unter `POST /api/v1/ingest/<name>` erreichbar:

```js
{
  name: 'healthchecks',
  description: 'healthchecks.io',
  parse({ body, rawBody, headers, query }, ctx) {
    if (!body?.name) throw new api.AdapterError('name fehlt');   // → HTTP 400
    return [{ title: `${body.name} down`, status: body.status === 'up' ? 'resolved' : 'firing', fingerprint: `hc:${body.name}` }];
  },
}
```

`headers` sind kleingeschrieben, `rawBody` ist der unveränderte Body (für Signaturprüfungen), `ctx.env(name)` liest
Umgebungsvariablen. Gib eine leere Liste zurück, um eine Anfrage zu ignorieren (z. B. Ping-Events).

## Prozessoren

Prozessoren laufen nach den Event-Regeln und vor der Deduplizierung. Sie können Ereignisse anreichern, umschreiben
oder verwerfen (`return null`):

```js
{
  name: 'env-from-host',
  process(event) {
    const m = /^(prod|staging)-/.exec(event.host ?? '');
    return m ? { ...event, labels: { ...event.labels, env: m[1] } } : event;
  },
}
```

Ein vollständiges Beispiel liegt unter [`examples/plugins/example-plugin.mjs`](../examples/plugins/example-plugin.mjs).
