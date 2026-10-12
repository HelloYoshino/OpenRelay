import { truncate } from '../../util/json.js';
import { linksOf, markdown, str } from '../format.js';
import type { Severity } from '../../types.js';
import { defineChannel, DeliveryError, httpRequest } from '../types.js';

const PRIORITY: Record<Severity, number> = { critical: 5, high: 4, warning: 3, info: 2, debug: 1 };
const TAGS: Record<Severity, string> = {
  critical: 'rotating_light',
  high: 'warning',
  warning: 'large_orange_diamond',
  info: 'information_source',
  debug: 'white_circle',
};

export const ntfyChannel = defineChannel({
  type: 'ntfy',
  displayName: 'ntfy (Push & Desktop)',
  description: 'Push-Benachrichtigungen auf Handy und Desktop über ntfy.sh oder einen eigenen ntfy-Server – mit „Bestätigen“-Button.',
  configSchema: [
    { key: 'server', label: 'Server', type: 'string', placeholder: 'https://ntfy.sh', default: 'https://ntfy.sh' },
    { key: 'topic', label: 'Topic', type: 'string', required: true, placeholder: 'mein-geheimes-topic' },
    { key: 'token', label: 'Access-Token', type: 'secret', help: 'Für geschützte Topics (alternativ Benutzer/Passwort).' },
    { key: 'user', label: 'Benutzer', type: 'string' },
    { key: 'password', label: 'Passwort', type: 'secret' },
  ],
  validate(config) {
    if (!/^[\w-]{1,64}$/.test(str(config.topic))) return ['Topic darf nur Buchstaben, Ziffern, - und _ enthalten'];
  },
  async send(message, config, ctx) {
    const topic = str(config.topic);
    if (!topic) throw new DeliveryError('Topic fehlt', false);
    const server = (str(config.server) || 'https://ntfy.sh').replace(/\/+$/, '');
    const headers: Record<string, string> = {};
    if (str(config.token)) headers.authorization = `Bearer ${str(config.token)}`;
    else if (str(config.user)) headers.authorization = `Basic ${Buffer.from(`${str(config.user)}:${str(config.password)}`).toString('base64')}`;

    const resolved = message.kind === 'incident.resolved';
    const actions: unknown[] = [];
    for (const link of linksOf(message).slice(0, 3)) {
      if (link.url === message.ackUrl || link.url === message.resolveUrl) {
        actions.push({ action: 'http', label: link.label, url: link.url, method: 'POST', clear: true });
      } else {
        actions.push({ action: 'view', label: link.label, url: link.url });
      }
    }
    await httpRequest(server, {
      headers,
      signal: ctx.signal,
      body: {
        topic,
        title: truncate(message.title, 250),
        message: truncate(markdown(message, { links: false }), 4000),
        markdown: true,
        priority: resolved ? 2 : PRIORITY[message.severity],
        tags: [resolved ? 'white_check_mark' : TAGS[message.severity]],
        click: message.url ?? undefined,
        actions,
      },
    });
  },
});
