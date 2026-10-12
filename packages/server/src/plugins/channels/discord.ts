import { truncate } from '../../util/json.js';
import { colorOf, linksOf, str } from '../format.js';
import { defineChannel, DeliveryError, httpRequest } from '../types.js';

export const discordChannel = defineChannel({
  type: 'discord',
  displayName: 'Discord',
  description: 'Nachricht über einen Discord-Webhook (Kanal-Einstellungen → Integrationen → Webhooks).',
  configSchema: [
    { key: 'webhookUrl', label: 'Webhook-URL', type: 'secret', required: true, placeholder: 'https://discord.com/api/webhooks/…' },
    { key: 'username', label: 'Anzeigename', type: 'string', placeholder: 'OpenRelay' },
    {
      key: 'mentionCritical',
      label: 'Erwähnung bei kritischen Vorfällen',
      type: 'string',
      placeholder: '@here oder <@&ROLLEN_ID>',
      help: 'Wird bei kritischen Vorfällen und Eskalationen vorangestellt.',
    },
  ],
  validate(config) {
    const url = str(config.webhookUrl);
    if (!/^https:\/\/(?:\w+\.)?discord(?:app)?\.com\/api\/webhooks\//.test(url)) return ['Keine gültige Discord-Webhook-URL'];
  },
  async send(message, config, ctx) {
    const links = linksOf(message);
    const description = [message.text, links.map((l) => `[${l.label}](${l.url})`).join(' · ')].filter(Boolean).join('\n\n');
    const mention = str(config.mentionCritical);
    const urgent = message.severity === 'critical' && message.kind !== 'incident.resolved' && message.kind !== 'digest';
    const body = {
      username: str(config.username) || 'OpenRelay',
      content: urgent && mention ? mention : undefined,
      allowed_mentions: { parse: ['everyone', 'roles', 'users'] },
      embeds: [
        {
          title: truncate(message.title, 256),
          url: message.url ?? undefined,
          description: truncate(description, 4000),
          color: colorOf(message),
          fields: message.fields.slice(0, 25).map((f) => ({ name: truncate(f.name, 256), value: truncate(f.value || '–', 1024), inline: f.value.length < 40 })),
          timestamp: new Date(message.timestamp).toISOString(),
          footer: { text: 'OpenRelay' },
        },
      ],
    };
    const url = str(config.webhookUrl);
    if (!url) throw new DeliveryError('Webhook-URL fehlt', false);
    await httpRequest(url, { body, signal: ctx.signal });
  },
});
