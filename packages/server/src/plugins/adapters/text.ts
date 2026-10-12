import { truncate } from '../../util/json.js';
import { AdapterError, type IngestAdapter } from '../types.js';
import type { EventInput } from '../../types.js';

export function parseLabelList(input: string | undefined): Record<string, string> {
  const labels: Record<string, string> = {};
  if (!input) return labels;
  for (const part of input.split(',')) {
    const [k, ...rest] = part.split('=');
    const key = k?.trim();
    if (!key) continue;
    labels[key] = rest.length ? rest.join('=').trim() : 'true';
  }
  return labels;
}

/** ntfy-style plain text publishing: `curl -d "Backup failed" …/ingest/text?severity=high`. */
export const textAdapter: IngestAdapter = {
  name: 'text',
  description: 'Klartext: erste Zeile = Titel, Rest = Nachricht. Header X-Title, X-Severity, X-Service, X-Tags.',
  parse({ body, rawBody, headers, query }) {
    let text = typeof body === 'string' ? body : rawBody ? rawBody.toString('utf8') : '';
    if (!text && body && typeof body === 'object') {
      const b = body as Record<string, unknown>;
      text = String(b.message ?? b.text ?? b.title ?? '');
    }
    text = text.replace(/\r\n/g, '\n').trim();
    const headerTitle = headers['x-title'] ?? headers['title'] ?? query.title;
    if (!text && !headerTitle) throw new AdapterError('Leere Nachricht');
    const [firstLine, ...rest] = text.split('\n');
    const title = truncate((headerTitle ?? firstLine).trim(), 300);
    const message = headerTitle ? text : rest.join('\n').trim();
    const event: EventInput = {
      title,
      message: message || undefined,
      severity: (headers['x-severity'] ?? headers['x-priority'] ?? headers['priority']) as EventInput['severity'],
      service: headers['x-service'],
      host: headers['x-host'],
      fingerprint: headers['x-fingerprint'] ?? query.fingerprint,
      correlationKey: headers['x-correlation-key'] ?? query.correlationKey,
      status: (headers['x-status'] ?? query.status) as EventInput['status'],
      url: headers['x-click'] ?? headers['x-url'] ?? query.url,
      labels: parseLabelList(headers['x-tags'] ?? headers['tags']),
    };
    return [event];
  },
};
