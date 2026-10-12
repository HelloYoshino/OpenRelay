import { createHmac } from 'node:crypto';
import { str } from '../format.js';
import { defineChannel, DeliveryError, httpRequest } from '../types.js';

export const webhookChannel = defineChannel({
  type: 'webhook',
  displayName: 'Webhook (JSON)',
  description: 'Sendet die Benachrichtigung als JSON an eine beliebige URL – optional HMAC-signiert.',
  configSchema: [
    { key: 'url', label: 'URL', type: 'string', required: true, placeholder: 'https://example.com/hooks/openrelay' },
    {
      key: 'method',
      label: 'Methode',
      type: 'select',
      default: 'POST',
      options: [
        { value: 'POST', label: 'POST' },
        { value: 'PUT', label: 'PUT' },
      ],
    },
    { key: 'headers', label: 'Zusätzliche Header (JSON)', type: 'text', placeholder: '{"Authorization": "Bearer …"}' },
    {
      key: 'secret',
      label: 'Signatur-Secret',
      type: 'secret',
      help: 'Wenn gesetzt, enthält der Header X-OpenRelay-Signature „sha256=<hmac>“ über den Request-Body.',
    },
  ],
  validate(config) {
    const errors: string[] = [];
    try {
      const url = new URL(str(config.url));
      if (!['http:', 'https:'].includes(url.protocol)) errors.push('Nur http(s)-URLs sind erlaubt');
    } catch {
      errors.push('Ungültige URL');
    }
    if (str(config.headers)) {
      try {
        JSON.parse(str(config.headers));
      } catch {
        errors.push('Header müssen gültiges JSON sein');
      }
    }
    return errors;
  },
  async send(message, config, ctx) {
    const url = str(config.url);
    if (!url) throw new DeliveryError('URL fehlt', false);
    let headers: Record<string, string> = {};
    if (str(config.headers)) {
      try {
        headers = JSON.parse(str(config.headers)) as Record<string, string>;
      } catch {
        throw new DeliveryError('Header sind kein gültiges JSON', false);
      }
    }
    const body = JSON.stringify({ kind: message.kind, message });
    headers['content-type'] = 'application/json';
    if (str(config.secret)) {
      headers['x-openrelay-signature'] = `sha256=${createHmac('sha256', str(config.secret)).update(body).digest('hex')}`;
    }
    await httpRequest(url, { method: str(config.method) || 'POST', headers, body, signal: ctx.signal });
  },
});
