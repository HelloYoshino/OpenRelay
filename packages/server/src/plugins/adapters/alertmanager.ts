import { isPlainObject } from '../../util/json.js';
import { AdapterError, type IngestAdapter } from '../types.js';
import type { EventInput } from '../../types.js';

interface AmAlert {
  status?: string;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
  startsAt?: string;
  endsAt?: string;
  generatorURL?: string;
  fingerprint?: string;
  dashboardURL?: string;
  panelURL?: string;
  silenceURL?: string;
  valueString?: string;
}

/** Shared parser for the Alertmanager webhook format (also used by Grafana). */
export function parseAlertmanagerPayload(body: unknown, source: string): EventInput[] {
  if (!isPlainObject(body) || !Array.isArray(body.alerts)) throw new AdapterError('Kein Alertmanager-Payload (alerts[] fehlt)');
  const common = (isPlainObject(body.commonLabels) ? body.commonLabels : {}) as Record<string, string>;
  const out: EventInput[] = [];
  for (const raw of body.alerts as AmAlert[]) {
    const labels = { ...common, ...(raw.labels ?? {}) };
    const ann = raw.annotations ?? {};
    const name = labels.alertname ?? 'Alert';
    const title = ann.summary ?? ann.title ?? (labels.instance ? `${name} (${labels.instance})` : name);
    const status = raw.status === 'resolved' ? 'resolved' : 'firing';
    const fp = raw.fingerprint
      ? `${source}:${raw.fingerprint}`
      : `${source}:${Object.entries(labels)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, v]) => `${k}=${v}`)
          .join(',')}`;
    out.push({
      title,
      source,
      message: ann.description ?? ann.message ?? raw.valueString ?? undefined,
      severity: (labels.severity ?? labels.priority ?? 'warning') as EventInput['severity'],
      status,
      type: name,
      service: labels.service ?? labels.app ?? labels.job ?? labels.namespace,
      host: labels.instance ?? labels.host ?? labels.node ?? labels.pod,
      fingerprint: fp,
      labels,
      url: raw.panelURL ?? raw.dashboardURL ?? raw.generatorURL ?? (typeof body.externalURL === 'string' ? body.externalURL : undefined),
      timestamp: status === 'resolved' && raw.endsAt && !raw.endsAt.startsWith('0001') ? raw.endsAt : raw.startsAt,
      // Alertmanager sends resolves itself and repeats firing alerts, so never time out.
      ttl: 0,
      payload: raw,
    });
  }
  return out;
}

export const alertmanagerAdapter: IngestAdapter = {
  name: 'alertmanager',
  description: 'Prometheus Alertmanager (webhook_configs).',
  parse: ({ body }) => parseAlertmanagerPayload(body, 'alertmanager'),
};

export const grafanaAdapter: IngestAdapter = {
  name: 'grafana',
  description: 'Grafana Alerting (Kontaktpunkt vom Typ Webhook).',
  parse: ({ body }) => parseAlertmanagerPayload(body, 'grafana'),
};
