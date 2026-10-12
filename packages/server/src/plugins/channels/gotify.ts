import { markdown, str } from '../format.js';
import type { Severity } from '../../types.js';
import { defineChannel, DeliveryError, httpRequest } from '../types.js';

const PRIORITY: Record<Severity, number> = { critical: 10, high: 8, warning: 5, info: 3, debug: 1 };

export const gotifyChannel = defineChannel({
  type: 'gotify',
  displayName: 'Gotify',
  description: 'Push-Nachrichten an einen selbst gehosteten Gotify-Server.',
  configSchema: [
    { key: 'url', label: 'Server-URL', type: 'string', required: true, placeholder: 'https://gotify.example.com' },
    { key: 'token', label: 'App-Token', type: 'secret', required: true },
  ],
  async send(message, config, ctx) {
    const base = str(config.url).replace(/\/+$/, '');
    if (!base || !str(config.token)) throw new DeliveryError('Server-URL oder Token fehlt', false);
    await httpRequest(`${base}/message`, {
      headers: { 'x-gotify-key': str(config.token) },
      signal: ctx.signal,
      body: {
        title: message.title,
        message: markdown(message),
        priority: message.kind === 'incident.resolved' ? 2 : PRIORITY[message.severity],
        extras: {
          'client::display': { contentType: 'text/markdown' },
          ...(message.url ? { 'client::notification': { click: { url: message.url } } } : {}),
        },
      },
    });
  },
});
