/**
 * Beispiel-Plugin für OpenRelay.
 *
 * Kopiere diese Datei nach $OPENRELAY_DATA_DIR/plugins/ (Docker: /data/plugins/) und starte OpenRelay neu.
 * Es zeigt alle drei Erweiterungspunkte:
 *   - Kanal    "teams"        – Microsoft Teams über einen Workflows-Webhook (Adaptive Card)
 *   - Adapter  "healthchecks" – Webhooks von healthchecks.io → POST /api/v1/ingest/healthchecks
 *   - Prozessor "env-from-host" – leitet labels.env aus Hostnamen wie "prod-db-1" ab
 *
 * Plugins brauchen keine Imports: Hilfsfunktionen kommen über `api` (httpRequest, DeliveryError, AdapterError).
 */
export default (api) => ({
  name: 'example-plugin',
  version: '1.0.0',

  channels: [
    {
      type: 'teams',
      displayName: 'Microsoft Teams',
      description: 'Adaptive Card über einen Teams-Workflows-Webhook („Post to a channel when a webhook request is received“).',
      configSchema: [{ key: 'webhookUrl', label: 'Webhook-URL', type: 'secret', required: true }],
      async send(message, config, ctx) {
        const color = { critical: 'Attention', high: 'Warning', warning: 'Warning', info: 'Accent', debug: 'Default' };
        const actions = [];
        if (message.ackUrl && message.status === 'open') actions.push({ type: 'Action.OpenUrl', title: 'Bestätigen', url: message.ackUrl });
        if (message.url) actions.push({ type: 'Action.OpenUrl', title: 'Öffnen', url: message.url });
        await api.httpRequest(String(config.webhookUrl), {
          signal: ctx.signal,
          body: {
            type: 'message',
            attachments: [
              {
                contentType: 'application/vnd.microsoft.card.adaptive',
                content: {
                  $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
                  type: 'AdaptiveCard',
                  version: '1.4',
                  body: [
                    {
                      type: 'TextBlock',
                      text: message.title,
                      weight: 'Bolder',
                      size: 'Medium',
                      wrap: true,
                      color: message.kind === 'incident.resolved' ? 'Good' : color[message.severity],
                    },
                    { type: 'TextBlock', text: message.text, wrap: true },
                    { type: 'FactSet', facts: message.fields.map((f) => ({ title: f.name, value: f.value })) },
                  ],
                  actions,
                },
              },
            ],
          },
        });
      },
    },
  ],

  adapters: [
    {
      name: 'healthchecks',
      description: 'healthchecks.io (Integration „Webhook“, Body: JSON mit $NAME, $STATUS, $CODE).',
      parse({ body }) {
        // Erwarteter Body in healthchecks.io: {"name": "$NAME", "status": "$STATUS", "code": "$CODE", "tags": "$TAGS"}
        if (!body || typeof body !== 'object' || !body.name) throw new api.AdapterError('Feld "name" fehlt');
        return [
          {
            title: `Cronjob „${body.name}“ meldet sich nicht`,
            source: 'healthchecks',
            severity: 'high',
            status: body.status === 'up' ? 'resolved' : 'firing',
            service: String(body.name),
            fingerprint: `healthchecks:${body.code ?? body.name}`,
            labels: body.tags ? Object.fromEntries(String(body.tags).split(' ').filter(Boolean).map((t) => [t, 'true'])) : {},
            ttl: 0,
          },
        ];
      },
    },
  ],

  processors: [
    {
      name: 'env-from-host',
      process(event) {
        if (event.labels.env || !event.host) return event;
        const match = /^(prod|staging|dev|test)[-.]/i.exec(event.host);
        return match ? { ...event, labels: { ...event.labels, env: match[1].toLowerCase() } } : event;
      },
    },
  ],
});
