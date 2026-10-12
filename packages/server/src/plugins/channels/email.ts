import { createTransport, type Transporter } from 'nodemailer';
import { html, list, plainText, str } from '../format.js';
import { defineChannel, DeliveryError } from '../types.js';

const transports = new Map<string, Transporter>();

function transportFor(config: Record<string, unknown>): Transporter {
  const key = JSON.stringify([config.host, config.port, config.secure, config.user, config.password, config.ignoreTls]);
  let transport = transports.get(key);
  if (!transport) {
    const port = Number(config.port) || 587;
    transport = createTransport({
      host: str(config.host),
      port,
      secure: config.secure === true || config.secure === 'true' || port === 465,
      auth: str(config.user) ? { user: str(config.user), pass: str(config.password) } : undefined,
      ignoreTLS: config.ignoreTls === true || config.ignoreTls === 'true',
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });
    if (transports.size > 20) transports.clear();
    transports.set(key, transport);
  }
  return transport;
}

export const emailChannel = defineChannel({
  type: 'email',
  displayName: 'E-Mail (SMTP)',
  description: 'Versand über einen beliebigen SMTP-Server.',
  configSchema: [
    { key: 'host', label: 'SMTP-Server', type: 'string', required: true, placeholder: 'smtp.example.com' },
    { key: 'port', label: 'Port', type: 'number', default: 587 },
    { key: 'secure', label: 'TLS direkt (Port 465)', type: 'boolean', default: false },
    { key: 'user', label: 'Benutzer', type: 'string' },
    { key: 'password', label: 'Passwort', type: 'secret' },
    { key: 'from', label: 'Absender', type: 'string', required: true, placeholder: 'OpenRelay <relay@example.com>' },
    { key: 'to', label: 'Empfänger', type: 'string', required: true, placeholder: 'ops@example.com, oncall@example.com' },
    { key: 'ignoreTls', label: 'STARTTLS deaktivieren', type: 'boolean', default: false, help: 'Nur für lokale Test-Server.' },
  ],
  validate(config) {
    const errors: string[] = [];
    if (!str(config.host)) errors.push('SMTP-Server fehlt');
    if (!str(config.from)) errors.push('Absender fehlt');
    if (list(config.to).length === 0) errors.push('Mindestens ein Empfänger erforderlich');
    return errors;
  },
  async send(message, config) {
    const to = list(config.to);
    if (!str(config.host) || to.length === 0) throw new DeliveryError('SMTP-Server oder Empfänger fehlt', false);
    try {
      await transportFor(config).sendMail({
        from: str(config.from),
        to,
        subject: message.title,
        text: plainText(message, { links: true }),
        html: html(message),
        priority: message.severity === 'critical' ? 'high' : 'normal',
      });
    } catch (err) {
      const e = err as Error & { responseCode?: number; code?: string };
      // 5xx SMTP replies and authentication errors won't succeed on retry; 4xx and network errors might.
      const permanent = (typeof e.responseCode === 'number' && e.responseCode >= 500) || e.code === 'EAUTH';
      throw new DeliveryError(`SMTP: ${e.message}`, !permanent);
    }
  },
});
