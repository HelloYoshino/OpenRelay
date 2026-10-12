import { alertmanagerAdapter, grafanaAdapter } from './adapters/alertmanager.js';
import { genericAdapter } from './adapters/generic.js';
import { githubAdapter } from './adapters/github.js';
import { gitlabAdapter } from './adapters/gitlab.js';
import { textAdapter } from './adapters/text.js';
import { uptimeKumaAdapter } from './adapters/uptime-kuma.js';
import { appriseChannel } from './channels/apprise.js';
import { consoleChannel } from './channels/console.js';
import { discordChannel } from './channels/discord.js';
import { emailChannel } from './channels/email.js';
import { gotifyChannel } from './channels/gotify.js';
import { matrixChannel } from './channels/matrix.js';
import { ntfyChannel } from './channels/ntfy.js';
import { pushoverChannel } from './channels/pushover.js';
import { slackChannel } from './channels/slack.js';
import { telegramChannel } from './channels/telegram.js';
import { webhookChannel } from './channels/webhook.js';
import type { OpenRelayPlugin } from './types.js';

export const builtinPlugin: OpenRelayPlugin = {
  name: 'builtin',
  channels: [
    discordChannel,
    telegramChannel,
    emailChannel,
    ntfyChannel,
    slackChannel,
    matrixChannel,
    gotifyChannel,
    pushoverChannel,
    appriseChannel,
    webhookChannel,
    consoleChannel,
  ],
  adapters: [genericAdapter, textAdapter, alertmanagerAdapter, grafanaAdapter, githubAdapter, gitlabAdapter, uptimeKumaAdapter],
};
