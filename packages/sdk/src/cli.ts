#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { OpenRelayClient, type RelayEvent, type Severity } from './index.js';

const HELP = `openrelay – Ereignisse an OpenRelay senden

Verwendung:
  openrelay send <titel> [optionen]      Ereignis melden
  openrelay resolve <titel> [optionen]   Ereignis als behoben melden

Optionen:
  -s, --severity <stufe>   debug | info | warning | high | critical (Standard: warning)
  -m, --message <text>     Details (oder per stdin mit --stdin)
      --source <name>      Quelle (Standard: Hostname)
      --service <name>     betroffener Service
      --host <name>        betroffener Host
      --fingerprint <key>  eigener Deduplizierungsschlüssel
      --key <key>          Korrelationsschlüssel (gruppiert Ereignisse)
  -l, --label <k=v>        Label (mehrfach möglich)
      --url <url>          Link zur Quelle
      --ttl <sekunden>     automatische Auflösung nach Stille (0 = nie)
      --stdin              Nachricht von stdin lesen
      --server <url>       OpenRelay-URL (Standard: $OPENRELAY_URL)
      --token <token>      API-Token (Standard: $OPENRELAY_TOKEN)
      --retries <n>        Wiederholungen bei Verbindungsfehlern (Standard: 3)
  -q, --quiet              keine Ausgabe

Beispiele:
  openrelay send "Backup fehlgeschlagen" -s high --service nas -m "rsync exit 23"
  ./deploy.sh || openrelay send "Deployment fehlgeschlagen" -s critical --key "deploy-$BUILD_ID"
  journalctl -u app -n 50 | openrelay send "App abgestürzt" -s critical --stdin
`;

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8').trim();
}

async function main(): Promise<number> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      severity: { type: 'string', short: 's' },
      message: { type: 'string', short: 'm' },
      source: { type: 'string' },
      service: { type: 'string' },
      host: { type: 'string' },
      fingerprint: { type: 'string' },
      key: { type: 'string' },
      label: { type: 'string', short: 'l', multiple: true },
      url: { type: 'string' },
      ttl: { type: 'string' },
      stdin: { type: 'boolean' },
      server: { type: 'string' },
      token: { type: 'string' },
      retries: { type: 'string' },
      quiet: { type: 'boolean', short: 'q' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  const [command, ...rest] = positionals;
  if (values.help || !command || command === 'help') {
    process.stdout.write(HELP);
    return command || values.help ? 0 : 1;
  }
  if (command !== 'send' && command !== 'resolve') {
    process.stderr.write(`Unbekannter Befehl: ${command}\n\n${HELP}`);
    return 1;
  }
  const title = rest.join(' ').trim();
  if (!title) {
    process.stderr.write('Titel fehlt.\n');
    return 1;
  }
  const url = values.server ?? process.env.OPENRELAY_URL;
  const token = values.token ?? process.env.OPENRELAY_TOKEN;
  if (!url || !token) {
    process.stderr.write('OPENRELAY_URL und OPENRELAY_TOKEN (oder --server/--token) sind erforderlich.\n');
    return 1;
  }
  const labels: Record<string, string> = {};
  for (const l of values.label ?? []) {
    const [k, ...v] = l.split('=');
    if (k) labels[k] = v.join('=') || 'true';
  }
  const { hostname } = await import('node:os');
  const event: RelayEvent = {
    title,
    status: command === 'resolve' ? 'resolved' : 'firing',
    severity: (values.severity as Severity | undefined) ?? 'warning',
    message: values.stdin ? await readStdin() : values.message,
    source: values.source ?? process.env.OPENRELAY_SOURCE ?? hostname(),
    service: values.service,
    host: values.host,
    fingerprint: values.fingerprint,
    correlationKey: values.key,
    labels: Object.keys(labels).length ? labels : undefined,
    url: values.url,
    ttl: values.ttl !== undefined ? Number(values.ttl) : undefined,
  };

  const client = new OpenRelayClient({ url, token, queue: false, timeoutMs: 10_000 });
  const retries = Math.max(0, Number(values.retries ?? 3));
  for (let attempt = 0; ; attempt++) {
    try {
      const result = await client.send(event);
      if (!values.quiet && result.status === 'sent') {
        const r = result.results[0];
        process.stdout.write(`${r?.action ?? 'ok'}${r?.incidentId ? ` → ${r.incidentId}` : ''}\n`);
      }
      return 0;
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status !== undefined || attempt >= retries) {
        process.stderr.write(`Fehler: ${(err as Error).message}\n`);
        return 2;
      }
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
    }
  }
}

main().then(
  (code) => process.exit(code),
  (err) => {
    process.stderr.write(`${(err as Error).message}\n`);
    process.exit(1);
  },
);
