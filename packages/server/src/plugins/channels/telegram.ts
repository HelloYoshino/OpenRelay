import { truncate } from '../../util/json.js';
import { escapeHtml, isLocalUrl, linksOf, str } from '../format.js';
import { defineChannel, DeliveryError, httpRequest } from '../types.js';

export const telegramChannel = defineChannel({
  type: 'telegram',
  displayName: 'Telegram',
  description: 'Nachricht über einen Telegram-Bot (Token von @BotFather, Chat-ID z. B. über @userinfobot).',
  configSchema: [
    { key: 'botToken', label: 'Bot-Token', type: 'secret', required: true, placeholder: '123456:ABC-DEF…' },
    { key: 'chatId', label: 'Chat-ID', type: 'string', required: true, placeholder: '-1001234567890' },
    { key: 'threadId', label: 'Thema-ID (optional)', type: 'string', help: 'Für Gruppen mit Themen (message_thread_id).' },
    { key: 'apiUrl', label: 'API-URL', type: 'string', placeholder: 'https://api.telegram.org', help: 'Nur für eigene Bot-API-Server ändern.' },
  ],
  validate(config) {
    const errors: string[] = [];
    if (!/^\d+:[\w-]+$/.test(str(config.botToken))) errors.push('Bot-Token hat ein ungültiges Format');
    if (!str(config.chatId)) errors.push('Chat-ID fehlt');
    return errors;
  },
  async send(message, config, ctx) {
    const lines = [`<b>${escapeHtml(message.title)}</b>`];
    if (message.text) lines.push('', escapeHtml(message.text));
    if (message.fields.length) {
      lines.push('', ...message.fields.map((f) => `<b>${escapeHtml(f.name)}:</b> ${escapeHtml(f.value)}`));
    }
    const links = linksOf(message);
    const buttonLinks = links.filter((l) => !isLocalUrl(l.url));
    const inlineLinks = links.filter((l) => isLocalUrl(l.url));
    if (inlineLinks.length) {
      lines.push('', inlineLinks.map((l) => `<a href="${escapeHtml(l.url)}">${escapeHtml(l.label)}</a>`).join(' · '));
    }
    const api = (str(config.apiUrl) || 'https://api.telegram.org').replace(/\/+$/, '');
    const token = str(config.botToken);
    if (!token) throw new DeliveryError('Bot-Token fehlt', false);
    const payload: Record<string, unknown> = {
      chat_id: str(config.chatId),
      text: truncate(lines.join('\n'), 4000),
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      disable_notification: message.severity === 'debug' || message.severity === 'info' || message.kind === 'digest',
    };
    if (str(config.threadId)) payload.message_thread_id = Number(config.threadId);
    if (buttonLinks.length) {
      payload.reply_markup = { inline_keyboard: [buttonLinks.map((l) => ({ text: l.label, url: l.url }))] };
    }
    try {
      await httpRequest(`${api}/bot${token}/sendMessage`, { body: payload, signal: ctx.signal });
    } catch (err) {
      // Telegram rejects some button URLs (e.g. private hosts) – retry once without buttons.
      if (err instanceof DeliveryError && /BUTTON_URL_INVALID|button/i.test(err.message) && payload.reply_markup) {
        delete payload.reply_markup;
        payload.text = truncate(`${payload.text}\n\n${buttonLinks.map((l) => `<a href="${escapeHtml(l.url)}">${escapeHtml(l.label)}</a>`).join(' · ')}`, 4000);
        await httpRequest(`${api}/bot${token}/sendMessage`, { body: payload, signal: ctx.signal });
        return;
      }
      throw err;
    }
  },
});
