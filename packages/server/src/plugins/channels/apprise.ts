import { markdown, str } from '../format.js';
import { defineChannel, DeliveryError, httpRequest } from '../types.js';

export const appriseChannel = defineChannel({
  type: 'apprise',
  displayName: 'Apprise API',
  description: 'Weiterleitung an einen Apprise-API-Server – erschließt über 100 weitere Dienste (Teams, Signal, SMS, …).',
  configSchema: [
    {
      key: 'url',
      label: 'Apprise-Endpunkt',
      type: 'string',
      required: true,
      placeholder: 'http://apprise:8000/notify oder http://apprise:8000/notify/<key>',
    },
    { key: 'urls', label: 'Apprise-URLs (optional)', type: 'text', placeholder: 'msteams://…, signal://…', help: 'Nur für den zustandslosen /notify-Endpunkt.' },
    { key: 'tag', label: 'Tag (optional)', type: 'string' },
  ],
  async send(message, config, ctx) {
    const url = str(config.url);
    if (!url) throw new DeliveryError('Endpunkt fehlt', false);
    const type =
      message.kind === 'incident.resolved'
        ? 'success'
        : message.severity === 'critical' || message.severity === 'high'
          ? 'failure'
          : message.severity === 'warning'
            ? 'warning'
            : 'info';
    await httpRequest(url, {
      signal: ctx.signal,
      body: {
        title: message.title,
        body: markdown(message),
        type,
        format: 'markdown',
        urls: str(config.urls) || undefined,
        tag: str(config.tag) || undefined,
      },
    });
  },
});
