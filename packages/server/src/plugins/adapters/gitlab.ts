import { timingSafeEqual } from 'node:crypto';
import { isPlainObject } from '../../util/json.js';
import { AdapterError, type IngestAdapter } from '../types.js';
import type { EventInput } from '../../types.js';

type Obj = Record<string, any>;

export const gitlabAdapter: IngestAdapter = {
  name: 'gitlab',
  description: 'GitLab-Webhooks: Pipeline- und Deployment-Events. Token: OPENRELAY_GITLAB_TOKEN.',
  parse({ body, headers }, ctx) {
    const expected = ctx.env('OPENRELAY_GITLAB_TOKEN');
    if (expected) {
      const actual = headers['x-gitlab-token'] ?? '';
      const ok = actual.length === expected.length && timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
      if (!ok) throw new AdapterError('Ungültiges X-Gitlab-Token');
    }
    if (!isPlainObject(body)) throw new AdapterError('Erwartet JSON-Payload');
    const b = body as Obj;
    const project = (b.project ?? {}) as Obj;
    const path = String(project.path_with_namespace ?? project.name ?? 'project');

    if (b.object_kind === 'pipeline') {
      const attrs = b.object_attributes as Obj;
      const status = String(attrs.status ?? '');
      const failed = status === 'failed';
      if (!failed && status !== 'success') return [];
      const ref = String(attrs.ref ?? '');
      const event: EventInput = {
        title: `Pipeline fehlgeschlagen (${path}@${ref})`,
        message: b.commit?.title ? `Commit: ${b.commit.title}` : undefined,
        source: 'gitlab',
        severity: failed ? (ref === project.default_branch ? 'high' : 'warning') : 'info',
        status: failed ? 'firing' : 'resolved',
        type: 'pipeline',
        service: String(project.name ?? path),
        fingerprint: `gitlab:pipeline:${path}:${ref}`,
        correlationKey: failed && attrs.sha ? `gitlab:${path}:${attrs.sha}` : undefined,
        labels: { project: path, ref, status },
        url: attrs.url ?? (project.web_url ? `${project.web_url}/-/pipelines/${attrs.id}` : undefined),
        ttl: 7 * 24 * 3600,
      };
      return [event];
    }

    if (b.object_kind === 'deployment') {
      const status = String(b.status ?? '');
      const failed = status === 'failed';
      if (!failed && status !== 'success') return [];
      const env = String(b.environment ?? 'unknown');
      return [
        {
          title: `Deployment nach „${env}“ fehlgeschlagen (${path})`,
          source: 'gitlab',
          severity: failed ? (/prod/i.test(env) ? 'critical' : 'high') : 'info',
          status: failed ? 'firing' : 'resolved',
          type: 'deployment',
          service: String(project.name ?? path),
          fingerprint: `gitlab:deployment:${path}:${env}`,
          labels: { project: path, environment: env, status },
          url: b.deployable_url,
          ttl: 7 * 24 * 3600,
        },
      ];
    }
    return [];
  },
};
