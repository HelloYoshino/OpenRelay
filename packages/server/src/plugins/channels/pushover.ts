import { truncate } from '../../util/json.js';
import { labelFor, plainText, str } from '../format.js';
import type { Severity } from '../../types.js';
import { defineChannel, DeliveryError, httpRequest } from '../types.js';

const PRIORITY: Record<Severity, number> = { critical: 1, high: 1, warning: 0, info: -1, debug: -2 };

export const pushoverChannel = defineChannel({
  type: 'pushover',
  displayName: 'Pushover',
  description: 'Push-Benachrichtigungen über pushover.net.',
  configSchema: [
    { key: 'userKey', label: 'User-Key', type: 'secret', required: true },
    { key: 'appToken', label: 'App-Token', type: 'secret', required: true },
    { key: 'device', label: 'Gerät (optional)', type: 'string' },
    {
      key: 'emergencyCritical',
      label: 'Notfall-Priorität für Kritisch',
      type: 'boolean',
      default: false,
      help: 'Wiederholt den Alarm alle 60 s, bis er in der App bestätigt wird.',
    },
  ],
  async send(message, config, ctx) {
    if (!str(config.userKey) || !str(config.appToken)) throw new DeliveryError('User-Key oder App-Token fehlt', false);
    const emergency =
      message.severity === 'critical' && message.kind !== 'incident.resolved' && (config.emergencyCritical === true || config.emergencyCritical === 'true');
    await httpRequest('https://api.pushover.net/1/messages.json', {
      signal: ctx.signal,
      body: {
        token: str(config.appToken),
        user: str(config.userKey),
        device: str(config.device) || undefined,
        title: truncate(message.title, 250),
        message: truncate(plainText(message), 1024),
        priority: message.kind === 'incident.resolved' ? -1 : emergency ? 2 : PRIORITY[message.severity],
        retry: emergency ? 60 : undefined,
        expire: emergency ? 3600 : undefined,
        url: message.ackUrl && message.status === 'open' ? message.ackUrl : message.url ?? undefined,
        url_title: message.ackUrl && message.status === 'open' ? labelFor(message, 'ack') : undefined,
        timestamp: Math.floor(message.timestamp / 1000),
      },
    });
  },
});
