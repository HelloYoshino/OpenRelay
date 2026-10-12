import { plainText } from '../format.js';
import { defineChannel } from '../types.js';

export const consoleChannel = defineChannel({
  type: 'console',
  displayName: 'Server-Log',
  description: 'Schreibt Benachrichtigungen ins Server-Log – praktisch zum Testen von Regeln.',
  configSchema: [],
  async send(message, _config, ctx) {
    ctx.logger.info({ kind: message.kind, severity: message.severity, incident: message.incident?.number }, `[notify] ${message.title}\n${plainText(message, { links: true })}`);
  },
});
