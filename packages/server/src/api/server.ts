import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import fastifyStatic from '@fastify/static';
import Fastify, { LogController, type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { ConfigError, ConfigService } from '../config-service.js';
import { IncidentError } from '../engine/incidents.js';
import { MatcherError } from '../engine/matcher.js';
import { EventValidationError } from '../engine/schema.js';
import { SettingsError } from '../engine/settings.js';
import { AdapterError } from '../plugins/types.js';
import type { OpenRelay } from '../relay.js';
import { Authenticator, hasScope, tokenFromRequest, type Principal, type RequiredScope } from './auth.js';
import { registerActionRoutes } from './routes/actions.js';
import { registerConfigRoutes } from './routes/config.js';
import { registerIncidentRoutes } from './routes/incidents.js';
import { registerIngestRoutes } from './routes/ingest.js';
import { registerStatusRoutes } from './routes/status.js';

declare module 'fastify' {
  interface FastifyContextConfig {
    scope?: RequiredScope;
  }
  interface FastifyRequest {
    principal: Principal | null;
    rawBody: Buffer | null;
  }
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface AppOptions {
  relay: OpenRelay;
  auth: Authenticator;
  webDir?: string | null;
  logger?: FastifyServerOptions['logger'] | false;
  loggerInstance?: FastifyServerOptions['loggerInstance'];
  trustProxy?: boolean;
  bodyLimit?: number;
  env?: Record<string, string | undefined>;
}

export interface AppContext {
  relay: OpenRelay;
  auth: Authenticator;
  config: ConfigService;
  env: Record<string, string | undefined>;
  startedAt: number;
}

export async function buildApp(opts: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: opts.loggerInstance ? undefined : (opts.logger ?? false),
    loggerInstance: opts.loggerInstance,
    trustProxy: opts.trustProxy ?? false,
    bodyLimit: opts.bodyLimit ?? 2 * 1024 * 1024,
    logController: new LogController({ disableRequestLogging: true }),
  });
  const ctx: AppContext = {
    relay: opts.relay,
    auth: opts.auth,
    config: new ConfigService(opts.relay),
    env: opts.env ?? process.env,
    startedAt: Date.now(),
  };

  app.decorateRequest('principal', null);
  app.decorateRequest('rawBody', null);

  // ---- body parsers: keep the raw body (webhook signatures, text adapter)
  app.removeAllContentTypeParsers();
  app.addContentTypeParser(['application/json', 'application/*+json'], { parseAs: 'buffer' }, (req, body: Buffer, done) => {
    req.rawBody = body;
    if (body.length === 0) return done(null, {});
    try {
      done(null, JSON.parse(body.toString('utf8')));
    } catch {
      done(new ApiError(400, 'Ungültiges JSON'), undefined);
    }
  });
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'buffer' }, (req, body: Buffer, done) => {
    req.rawBody = body;
    done(null, Object.fromEntries(new URLSearchParams(body.toString('utf8'))));
  });
  app.addContentTypeParser('*', { parseAs: 'buffer' }, (req, body: Buffer, done) => {
    req.rawBody = body;
    done(null, body.toString('utf8'));
  });

  // ---- authentication
  app.addHook('onRequest', async (req) => {
    const scope = req.routeOptions.config?.scope ?? (req.url.startsWith('/api/') ? 'admin' : 'public');
    if (scope === 'public') return;
    const principal = opts.auth.resolve(tokenFromRequest(req));
    if (!principal) throw new ApiError(401, 'Nicht angemeldet: Token fehlt oder ist ungültig');
    if (scope !== 'any' && !hasScope(principal, scope)) throw new ApiError(403, `Berechtigung "${scope}" erforderlich`);
    req.principal = principal;
  });

  // ---- errors
  app.setErrorHandler((err, req, reply) => {
    let status = 500;
    let message = 'Interner Fehler';
    if (err instanceof ApiError || err instanceof ConfigError || err instanceof IncidentError) {
      status = err.status;
      message = err.message;
    } else if (err instanceof EventValidationError || err instanceof SettingsError) {
      status = 400;
      message = err.message;
    } else if (err instanceof MatcherError || err instanceof AdapterError) {
      status = 400;
      message = err.message;
    } else if (typeof (err as { statusCode?: number }).statusCode === 'number' && (err as { statusCode: number }).statusCode < 500) {
      status = (err as { statusCode: number }).statusCode;
      message = (err as Error).message;
    }
    if (status >= 500) req.log.error({ err }, 'Unbehandelter Fehler');
    void reply.status(status).send({ error: message });
  });

  registerStatusRoutes(app, ctx);
  registerIngestRoutes(app, ctx);
  registerIncidentRoutes(app, ctx);
  registerConfigRoutes(app, ctx);
  registerActionRoutes(app, ctx);

  // ---- dashboard
  const webDir = opts.webDir;
  if (webDir && existsSync(join(webDir, 'index.html'))) {
    await app.register(fastifyStatic, { root: webDir, prefix: '/', wildcard: false, index: ['index.html'] });
    const indexHtml = readFileSync(join(webDir, 'index.html'), 'utf8');
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api/') && (req.headers.accept ?? '').includes('text/html')) {
        return reply.type('text/html; charset=utf-8').send(indexHtml);
      }
      return reply.status(404).send({ error: 'Nicht gefunden' });
    });
  } else {
    app.get('/', { config: { scope: 'public' } }, async (_req, reply) =>
      reply
        .type('text/html; charset=utf-8')
        .send('<!doctype html><meta charset="utf-8"><title>OpenRelay</title><p>OpenRelay läuft. Das Dashboard ist nicht gebaut (<code>npm run build -w @openrelay/web</code>).</p>'),
    );
    app.setNotFoundHandler((_req, reply) => reply.status(404).send({ error: 'Nicht gefunden' }));
  }

  return app;
}
