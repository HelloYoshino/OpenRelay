import { RESOLVED_COLOR, SEVERITY_COLOR } from '../engine/severity.js';
import type { NotificationMessage } from '../types.js';

export function escapeHtml(input: string): string {
  return input.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function isResolvedMessage(m: NotificationMessage): boolean {
  return m.kind === 'incident.resolved';
}

export function colorOf(m: NotificationMessage): number {
  return isResolvedMessage(m) ? RESOLVED_COLOR : SEVERITY_COLOR[m.severity];
}

export function colorHex(m: NotificationMessage): string {
  return `#${colorOf(m).toString(16).padStart(6, '0')}`;
}

export interface LinkSpec {
  label: string;
  url: string;
}

/** Action links in a sensible order (acknowledge first, only while the incident is open). */
export function linksOf(m: NotificationMessage): LinkSpec[] {
  const links: LinkSpec[] = [];
  if (m.ackUrl && m.status === 'open') links.push({ label: labelFor(m, 'ack'), url: m.ackUrl });
  if (m.resolveUrl && m.status !== 'resolved' && m.kind !== 'digest') links.push({ label: labelFor(m, 'resolve'), url: m.resolveUrl });
  if (m.url) links.push({ label: labelFor(m, 'open'), url: m.url });
  if (m.incident?.sourceUrl) links.push({ label: 'Quelle', url: m.incident.sourceUrl });
  return links;
}

const ACTION_LABELS: Record<string, Record<'ack' | 'resolve' | 'open', string>> = {
  de: { ack: 'Bestätigen', resolve: 'Auflösen', open: 'Öffnen' },
  en: { ack: 'Acknowledge', resolve: 'Resolve', open: 'Open' },
};

let currentLocale: 'de' | 'en' = 'de';

/** Set by the engine whenever settings change, so channels label buttons in the configured language. */
export function setFormatLocale(locale: 'de' | 'en'): void {
  currentLocale = locale;
}

export function labelFor(_m: NotificationMessage, action: 'ack' | 'resolve' | 'open'): string {
  return ACTION_LABELS[currentLocale][action];
}

/** Plain text: body, fields and (optionally) links. */
export function plainText(m: NotificationMessage, opts: { fields?: boolean; links?: boolean } = {}): string {
  const parts: string[] = [];
  if (m.text) parts.push(m.text);
  if (opts.fields !== false && m.fields.length > 0) parts.push(m.fields.map((f) => `${f.name}: ${f.value}`).join('\n'));
  if (opts.links && m.kind !== 'test') {
    const links = linksOf(m);
    if (links.length) parts.push(links.map((l) => `${l.label}: ${l.url}`).join('\n'));
  }
  return parts.join('\n\n');
}

/** Markdown (ntfy, Gotify, Apprise, Discord-compatible subset). */
export function markdown(m: NotificationMessage, opts: { links?: boolean; fields?: boolean } = {}): string {
  const parts: string[] = [];
  if (m.text) parts.push(m.text);
  if (opts.fields !== false && m.fields.length > 0) parts.push(m.fields.map((f) => `**${f.name}:** ${f.value}`).join('\n'));
  if (opts.links !== false) {
    const links = linksOf(m);
    if (links.length) parts.push(links.map((l) => `[${l.label}](${l.url})`).join(' · '));
  }
  return parts.join('\n\n');
}

/** Simple, email-client-safe HTML. */
export function html(m: NotificationMessage): string {
  const color = colorHex(m);
  const body = escapeHtml(m.text).replace(/\n/g, '<br>');
  const fields = m.fields
    .map(
      (f) =>
        `<tr><td style="padding:4px 12px 4px 0;color:#666;white-space:nowrap;vertical-align:top">${escapeHtml(f.name)}</td><td style="padding:4px 0">${escapeHtml(f.value)}</td></tr>`,
    )
    .join('');
  const links = linksOf(m)
    .map(
      (l) =>
        `<a href="${escapeHtml(l.url)}" style="display:inline-block;margin:0 8px 8px 0;padding:8px 14px;border-radius:6px;background:#1f2937;color:#fff;text-decoration:none;font-size:14px">${escapeHtml(l.label)}</a>`,
    )
    .join('');
  return `<!doctype html><html><body style="margin:0;padding:24px;background:#f4f5f7;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111">
<table role="presentation" width="100%" style="max-width:640px;margin:0 auto;background:#fff;border-radius:8px;border-top:4px solid ${color}">
<tr><td style="padding:20px 24px">
<h2 style="margin:0 0 12px;font-size:18px">${escapeHtml(m.title)}</h2>
<div style="font-size:14px;line-height:1.5;margin-bottom:16px">${body}</div>
${fields ? `<table style="font-size:14px;margin-bottom:16px">${fields}</table>` : ''}
${links ? `<div>${links}</div>` : ''}
<div style="margin-top:16px;font-size:12px;color:#888">OpenRelay</div>
</td></tr></table></body></html>`;
}

export function isLocalUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.endsWith('.local') || !host.includes('.');
  } catch {
    return true;
  }
}

export function str(v: unknown): string {
  return v === undefined || v === null ? '' : String(v).trim();
}

export function list(v: unknown): string[] {
  return str(v)
    .split(/[,;\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}
