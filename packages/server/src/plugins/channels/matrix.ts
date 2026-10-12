import { randomBytes } from 'node:crypto';
import { escapeHtml, linksOf, plainText, str } from '../format.js';
import { defineChannel, DeliveryError, httpRequest } from '../types.js';

export const matrixChannel = defineChannel({
  type: 'matrix',
  displayName: 'Matrix',
  description: 'Nachricht in einen Matrix-Raum (z. B. Element) über einen Bot-Account.',
  configSchema: [
    { key: 'homeserver', label: 'Homeserver', type: 'string', required: true, placeholder: 'https://matrix.org' },
    { key: 'accessToken', label: 'Access-Token', type: 'secret', required: true },
    { key: 'roomId', label: 'Raum-ID', type: 'string', required: true, placeholder: '!abcdef:matrix.org' },
  ],
  async send(message, config, ctx) {
    const base = str(config.homeserver).replace(/\/+$/, '');
    const room = str(config.roomId);
    if (!base || !room || !str(config.accessToken)) throw new DeliveryError('Homeserver, Raum oder Token fehlt', false);
    const links = linksOf(message);
    const formatted = [
      `<h4>${escapeHtml(message.title)}</h4>`,
      message.text ? `<p>${escapeHtml(message.text).replace(/\n/g, '<br>')}</p>` : '',
      message.fields.length ? `<p>${message.fields.map((f) => `<b>${escapeHtml(f.name)}:</b> ${escapeHtml(f.value)}`).join('<br>')}</p>` : '',
      links.length ? `<p>${links.map((l) => `<a href="${escapeHtml(l.url)}">${escapeHtml(l.label)}</a>`).join(' · ')}</p>` : '',
    ].join('');
    const txn = `or${Date.now()}${randomBytes(4).toString('hex')}`;
    await httpRequest(`${base}/_matrix/client/v3/rooms/${encodeURIComponent(room)}/send/m.room.message/${txn}`, {
      method: 'PUT',
      headers: { authorization: `Bearer ${str(config.accessToken)}` },
      signal: ctx.signal,
      body: {
        msgtype: message.severity === 'debug' || message.severity === 'info' ? 'm.notice' : 'm.text',
        body: `${message.title}\n\n${plainText(message, { links: true })}`,
        format: 'org.matrix.custom.html',
        formatted_body: formatted,
      },
    });
  },
});
