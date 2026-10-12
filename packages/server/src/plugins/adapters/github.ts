import { createHmac, timingSafeEqual } from 'node:crypto';
import { isPlainObject } from '../../util/json.js';
import { AdapterError, type AdapterContext, type IngestAdapter } from '../types.js';
import type { EventInput } from '../../types.js';

type Obj = Record<string, any>;

const WEEK_SECONDS = 7 * 24 * 3600;

function verifySignature(rawBody: Buffer | null, header: string | undefined, secret: string): boolean {
  if (!rawBody || !header?.startsWith('sha256=')) return false;
  const expected = Buffer.from(`sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`);
  const actual = Buffer.from(header);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function securitySeverity(level: string | undefined): EventInput['severity'] {
  switch ((level ?? '').toLowerCase()) {
    case 'critical':
      return 'critical';
    case 'high':
    case 'error':
      return 'high';
    case 'medium':
    case 'moderate':
    case 'warning':
      return 'warning';
    default:
      return 'info';
  }
}

function workflowRun(body: Obj): EventInput[] {
  if (body.action !== 'completed') return [];
  const run = body.workflow_run as Obj;
  const repo = body.repository as Obj;
  const conclusion = String(run.conclusion ?? '');
  const failed = ['failure', 'timed_out', 'startup_failure'].includes(conclusion);
  if (!failed && conclusion !== 'success') return [];
  const branch = String(run.head_branch ?? '');
  const isDefault = branch === repo.default_branch;
  return [
    {
      title: `Workflow „${run.name}“ fehlgeschlagen (${repo.full_name}@${branch})`,
      message: `${run.display_title ?? ''}\nCommit ${String(run.head_sha ?? '').slice(0, 7)} von ${run.actor?.login ?? 'unbekannt'} · Ergebnis: ${conclusion}`.trim(),
      source: 'github',
      severity: failed ? (isDefault ? 'high' : 'warning') : 'info',
      status: failed ? 'firing' : 'resolved',
      type: 'workflow_run',
      service: repo.name,
      fingerprint: `github:workflow:${repo.full_name}:${run.workflow_id}:${branch}`,
      correlationKey: failed ? `github:${repo.full_name}:${run.head_sha}` : undefined,
      labels: {
        repo: repo.full_name,
        branch,
        workflow: String(run.name),
        event: String(run.event ?? ''),
        actor: String(run.actor?.login ?? ''),
        conclusion,
      },
      url: run.html_url,
      ttl: WEEK_SECONDS,
    },
  ];
}

function deploymentStatus(body: Obj): EventInput[] {
  const status = body.deployment_status as Obj;
  const deployment = body.deployment as Obj;
  const repo = body.repository as Obj;
  const state = String(status.state ?? '');
  const failed = state === 'failure' || state === 'error';
  if (!failed && state !== 'success') return [];
  const env = String(status.environment ?? deployment.environment ?? 'unknown');
  return [
    {
      title: `Deployment nach „${env}“ fehlgeschlagen (${repo.full_name})`,
      message: status.description ?? undefined,
      source: 'github',
      severity: failed ? (/prod/i.test(env) ? 'critical' : 'high') : 'info',
      status: failed ? 'firing' : 'resolved',
      type: 'deployment',
      service: repo.name,
      fingerprint: `github:deployment:${repo.full_name}:${env}`,
      correlationKey: failed ? `github:${repo.full_name}:${deployment.sha}` : undefined,
      labels: { repo: repo.full_name, environment: env, ref: String(deployment.ref ?? ''), state },
      url: status.target_url || status.log_url || deployment.url,
      ttl: WEEK_SECONDS,
    },
  ];
}

function securityAlert(kind: string, body: Obj): EventInput[] {
  const alert = body.alert as Obj;
  const repo = body.repository as Obj;
  const action = String(body.action ?? '');
  const opened = ['created', 'reopened', 'reopened_by_user', 'appeared_in_branch'].includes(action);
  const closed = ['fixed', 'dismissed', 'auto_dismissed', 'resolved', 'closed_by_user'].includes(action);
  if (!opened && !closed) return [];
  let title: string;
  let severity: EventInput['severity'];
  if (kind === 'dependabot_alert') {
    const pkg = alert.dependency?.package?.name ?? alert.security_vulnerability?.package?.name ?? 'Paket';
    title = `Sicherheitslücke in ${pkg}: ${alert.security_advisory?.summary ?? ''}`.trim();
    severity = securitySeverity(alert.security_advisory?.severity ?? alert.security_vulnerability?.severity);
  } else if (kind === 'secret_scanning_alert') {
    title = `Secret im Repository entdeckt: ${alert.secret_type_display_name ?? alert.secret_type ?? 'unbekannt'}`;
    severity = 'critical';
  } else {
    title = `Code-Scanning: ${alert.rule?.description ?? alert.rule?.id ?? 'Befund'}`;
    severity = securitySeverity(alert.rule?.security_severity_level ?? alert.rule?.severity);
  }
  return [
    {
      title,
      source: 'github',
      severity,
      status: opened ? 'firing' : 'resolved',
      type: kind,
      service: repo.name,
      fingerprint: `github:${kind}:${repo.full_name}:${alert.number}`,
      labels: { repo: repo.full_name, kind },
      url: alert.html_url,
      ttl: 0,
    },
  ];
}

export const githubAdapter: IngestAdapter = {
  name: 'github',
  description: 'GitHub-Webhooks: workflow_run, deployment_status, dependabot/secret/code-scanning-Alerts. Secret: OPENRELAY_GITHUB_SECRET.',
  parse({ body, rawBody, headers }, ctx: AdapterContext) {
    const secret = ctx.env('OPENRELAY_GITHUB_SECRET');
    if (secret && !verifySignature(rawBody, headers['x-hub-signature-256'], secret)) {
      throw new AdapterError('Ungültige GitHub-Signatur (X-Hub-Signature-256)');
    }
    const event = headers['x-github-event'];
    if (!event) throw new AdapterError('Header X-GitHub-Event fehlt');
    if (!isPlainObject(body)) throw new AdapterError('Erwartet JSON-Payload');
    switch (event) {
      case 'ping':
        return [];
      case 'workflow_run':
        return workflowRun(body);
      case 'deployment_status':
        return deploymentStatus(body);
      case 'dependabot_alert':
      case 'secret_scanning_alert':
      case 'code_scanning_alert':
        return securityAlert(event, body);
      default:
        return [];
    }
  },
};
