import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface ServerConfig {
  host: string;
  port: number;
  dataDir: string;
  databasePath: string;
  publicUrl: string;
  adminToken: string | null;
  secret: string | null;
  pluginDir: string;
  configFile: string | null;
  webDir: string | null;
  logLevel: string;
  trustProxy: boolean;
  bodyLimit: number;
}

function findWebDir(): string | null {
  const here = dirname(fileURLToPath(import.meta.url));
  // dist/ → ../../web/dist (monorepo, Docker) or src/ during development
  for (const candidate of [resolve(here, '../../web/dist'), resolve(here, '../web'), resolve(process.cwd(), 'packages/web/dist')]) {
    if (existsSync(join(candidate, 'index.html'))) return candidate;
  }
  return null;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): ServerConfig {
  const port = Number(env.PORT ?? env.OPENRELAY_PORT ?? 8080);
  const dataDir = resolve(env.OPENRELAY_DATA_DIR ?? './data');
  const configFile = env.OPENRELAY_CONFIG ?? (existsSync(join(dataDir, 'openrelay.yaml')) ? join(dataDir, 'openrelay.yaml') : null);
  return {
    host: env.HOST ?? env.OPENRELAY_HOST ?? '0.0.0.0',
    port,
    dataDir,
    databasePath: env.OPENRELAY_DB ?? join(dataDir, 'openrelay.db'),
    publicUrl: (env.OPENRELAY_PUBLIC_URL ?? `http://localhost:${port}`).replace(/\/+$/, ''),
    adminToken: env.OPENRELAY_ADMIN_TOKEN || null,
    secret: env.OPENRELAY_SECRET || null,
    pluginDir: resolve(env.OPENRELAY_PLUGIN_DIR ?? join(dataDir, 'plugins')),
    configFile: configFile ? resolve(configFile) : null,
    webDir: env.OPENRELAY_WEB_DIR ? resolve(env.OPENRELAY_WEB_DIR) : findWebDir(),
    logLevel: env.OPENRELAY_LOG_LEVEL ?? 'info',
    trustProxy: env.OPENRELAY_TRUST_PROXY === 'true' || env.OPENRELAY_TRUST_PROXY === '1',
    bodyLimit: Number(env.OPENRELAY_BODY_LIMIT ?? 2 * 1024 * 1024),
  };
}
