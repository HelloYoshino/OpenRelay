#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { pino } from 'pino';
import { Authenticator } from './api/auth.js';
import { buildApp } from './api/server.js';
import { loadConfig } from './config.js';
import { ConfigService } from './config-service.js';
import { exportConfig, importConfig, importConfigFile, parseConfigText } from './provisioning.js';
import { OpenRelay } from './relay.js';
import { VERSION } from './version.js';

const HELP = `OpenRelay ${VERSION} – Event-Intelligence & Benachrichtigungen

Verwendung:
  openrelay-server                     Server starten
  openrelay-server rotate-admin-token  Neues Admin-Token erzeugen und ausgeben
  openrelay-server import <datei>      Konfiguration (YAML/JSON) importieren
  openrelay-server export [--secrets]  Konfiguration als YAML ausgeben
  openrelay-server --version | --help

Wichtige Umgebungsvariablen:
  PORT (8080), OPENRELAY_DATA_DIR (./data), OPENRELAY_PUBLIC_URL, OPENRELAY_ADMIN_TOKEN,
  OPENRELAY_CONFIG (YAML-Provisioning), OPENRELAY_PLUGIN_DIR, OPENRELAY_LOG_LEVEL
`;

function banner(token: string): string {
  const line = '═'.repeat(64);
  return `\n╔${line}╗\n║  Neues Admin-Token (wird nur einmal angezeigt):${' '.repeat(16)}║\n║  ${token.padEnd(62)}║\n╚${line}╝\n`;
}

async function main(argv: string[]): Promise<void> {
  const [command, ...args] = argv;
  if (command === '--help' || command === '-h' || command === 'help') {
    process.stdout.write(HELP);
    return;
  }
  if (command === '--version' || command === '-v') {
    process.stdout.write(`${VERSION}\n`);
    return;
  }

  const config = loadConfig();
  const logger = pino({ level: config.logLevel, base: undefined, timestamp: pino.stdTimeFunctions.isoTime });

  if (command && command !== 'serve') {
    const relay = await OpenRelay.create({ databasePath: config.databasePath, publicUrl: config.publicUrl, secret: config.secret ?? undefined });
    const service = new ConfigService(relay);
    try {
      if (command === 'rotate-admin-token') {
        const token = new Authenticator(relay, null).rotateAdminToken();
        process.stdout.write(banner(token));
      } else if (command === 'import') {
        const file = args[0];
        if (!file || !existsSync(file)) throw new Error('Datei nicht gefunden');
        const summary = importConfig(relay, service, parseConfigText(readFileSync(file, 'utf8')));
        process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
      } else if (command === 'export') {
        process.stdout.write(exportConfig(relay, service, args.includes('--secrets')));
      } else {
        process.stderr.write(`Unbekannter Befehl: ${command}\n\n${HELP}`);
        process.exitCode = 1;
      }
    } finally {
      await relay.close();
    }
    return;
  }

  const relay = await OpenRelay.create({
    databasePath: config.databasePath,
    publicUrl: config.publicUrl,
    pluginDir: config.pluginDir,
    secret: config.secret ?? undefined,
    logger,
  });
  const auth = new Authenticator(relay, config.adminToken);
  const generated = auth.ensureAdminToken();
  if (generated) {
    process.stdout.write(banner(generated));
    logger.warn('Admin-Token wurde generiert (siehe oben). Setze OPENRELAY_ADMIN_TOKEN, um ein eigenes festzulegen.');
  }

  const service = new ConfigService(relay);
  const provision = () => {
    if (!config.configFile) return;
    if (!existsSync(config.configFile)) {
      logger.warn(`Konfigurationsdatei ${config.configFile} nicht gefunden`);
      return;
    }
    const summary = importConfigFile(relay, service, config.configFile);
    logger.info({ ...summary }, `Konfiguration aus ${config.configFile} übernommen`);
  };
  try {
    provision();
  } catch (err) {
    logger.fatal(`Konfiguration ungültig: ${(err as Error).message}`);
    process.exit(1);
  }

  const app = await buildApp({
    relay,
    auth,
    webDir: config.webDir,
    loggerInstance: logger,
    trustProxy: config.trustProxy,
    bodyLimit: config.bodyLimit,
  });
  await app.listen({ host: config.host, port: config.port });
  relay.start();
  logger.info(
    { version: VERSION, publicUrl: config.publicUrl, database: config.databasePath, dashboard: config.webDir ? 'aktiv' : 'nicht gebaut' },
    `OpenRelay läuft auf ${config.host}:${config.port}`,
  );

  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    logger.info(`${signal} empfangen, fahre herunter …`);
    const force = setTimeout(() => process.exit(1), 10_000);
    force.unref();
    await app.close();
    await relay.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGHUP', () => {
    try {
      provision();
    } catch (err) {
      logger.error(`Neuladen fehlgeschlagen: ${(err as Error).message}`);
    }
  });
}

main(process.argv.slice(2)).catch((err) => {
  process.stderr.write(`${(err as Error).stack ?? err}\n`);
  process.exit(1);
});
