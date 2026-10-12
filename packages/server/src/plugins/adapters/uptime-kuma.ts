import { isPlainObject } from '../../util/json.js';
import { AdapterError, type IngestAdapter } from '../types.js';
import type { EventInput } from '../../types.js';

type Obj = Record<string, any>;

export const uptimeKumaAdapter: IngestAdapter = {
  name: 'uptime-kuma',
  description: 'Uptime Kuma (Benachrichtigungstyp Webhook, Body „application/json“).',
  parse({ body }) {
    if (!isPlainObject(body)) throw new AdapterError('Erwartet JSON-Payload');
    const b = body as Obj;
    const monitor = (b.monitor ?? null) as Obj | null;
    const heartbeat = (b.heartbeat ?? null) as Obj | null;
    if (!monitor || !heartbeat) {
      // "Test" button in Uptime Kuma sends only `msg`.
      return [{ title: String(b.msg ?? 'Uptime Kuma Test'), source: 'uptime-kuma', severity: 'info', status: 'resolved' } satisfies EventInput];
    }
    const status = Number(heartbeat.status);
    if (status !== 0 && status !== 1) return []; // pending (2) / maintenance (3)
    const name = String(monitor.name ?? monitor.id);
    let host: string | undefined;
    try {
      host = monitor.hostname ?? (monitor.url ? new URL(monitor.url).hostname : undefined);
    } catch {
      host = undefined;
    }
    return [
      {
        title: `${name} ist nicht erreichbar`,
        message: heartbeat.msg ? String(heartbeat.msg) : undefined,
        source: 'uptime-kuma',
        severity: 'high',
        status: status === 0 ? 'firing' : 'resolved',
        type: String(monitor.type ?? 'monitor'),
        service: name,
        host,
        fingerprint: `uptime-kuma:${monitor.id ?? name}`,
        labels: { monitor: name, ...(monitor.type ? { monitorType: String(monitor.type) } : {}) },
        url: monitor.url && /^https?:/.test(monitor.url) ? monitor.url : undefined,
        timestamp: heartbeat.time ? String(heartbeat.time).replace(' ', 'T') + (/[zZ+]/.test(String(heartbeat.time)) ? '' : 'Z') : undefined,
        ttl: 0,
      },
    ];
  },
};
