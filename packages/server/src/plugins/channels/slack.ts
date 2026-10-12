import { truncate } from '../../util/json.js';
import { colorHex, linksOf, str } from '../format.js';
import { defineChannel, DeliveryError, httpRequest } from '../types.js';

function slackEscape(input: string): string {
  return input.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export const slackChannel = defineChannel({
  type: 'slack',
  displayName: 'Slack',
  description: 'Nachricht über einen Slack-Incoming-Webhook (auch kompatibel mit Mattermost und Rocket.Chat).',
  configSchema: [
    { key: 'webhookUrl', label: 'Webhook-URL', type: 'secret', required: true, placeholder: 'https://hooks.slack.com/services/…' },
    { key: 'username', label: 'Anzeigename', type: 'string', placeholder: 'OpenRelay' },
    { key: 'mentionCritical', label: 'Erwähnung bei kritischen Vorfällen', type: 'string', placeholder: '<!here> oder <!subteam^ID>' },
  ],
  async send(message, config, ctx) {
    const url = str(config.webhookUrl);
    if (!url) throw new DeliveryError('Webhook-URL fehlt', false);
    const links = linksOf(message);
    const urgent = message.severity === 'critical' && message.kind !== 'incident.resolved' && message.kind !== 'digest';
    const mention = urgent ? str(config.mentionCritical) : '';
    const blocks: unknown[] = [
      { type: 'section', text: { type: 'mrkdwn', text: truncate(`*${slackEscape(message.title)}*${message.text ? `\n${slackEscape(message.text)}` : ''}`, 2900) } },
    ];
    if (message.fields.length) {
      blocks.push({
        type: 'section',
        fields: message.fields.slice(0, 10).map((f) => ({ type: 'mrkdwn', text: truncate(`*${slackEscape(f.name)}*\n${slackEscape(f.value)}`, 1900) })),
      });
    }
    if (links.length) {
      blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: links.map((l) => `<${l.url}|${slackEscape(l.label)}>`).join('  ·  ') }] });
    }
    await httpRequest(url, {
      signal: ctx.signal,
      body: {
        username: str(config.username) || 'OpenRelay',
        text: `${mention ? `${mention} ` : ''}${message.title}`,
        attachments: [{ color: colorHex(message), blocks }],
      },
    });
  },
});
