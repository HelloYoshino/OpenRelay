#!/usr/bin/env node
/**
 * Spielt ein realistisches Szenario gegen einen laufenden OpenRelay-Server ab.
 *
 *   OPENRELAY_URL=http://localhost:8080 OPENRELAY_TOKEN=<admin-token> node scripts/demo.mjs
 *
 * Mit --setup werden zusätzlich ein Log-Kanal, eine Routing-Regel und eine Topologie angelegt.
 */
const url = (process.env.OPENRELAY_URL ?? 'http://localhost:8080').replace(/\/+$/, '');
const token = process.env.OPENRELAY_TOKEN;
if (!token) {
  console.error('OPENRELAY_TOKEN fehlt (Admin-Token oder API-Key mit Scope admin).');
  process.exit(1);
}
const setup = process.argv.includes('--setup');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(method, path, body) {
  const res = await fetch(`${url}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

const send = (events) => api('POST', '/api/v1/events', events);

if (setup) {
  await api('PUT', '/api/v1/topology', {
    items: [
      { service: 'api', dependsOn: 'postgres' },
      { service: 'worker', dependsOn: 'postgres' },
      { service: 'delta-ai', dependsOn: 'api' },
      { service: 'discord-bot', dependsOn: 'api' },
    ],
  });
  const { items: channels } = await api('GET', '/api/v1/channels');
  let log = channels.find((c) => c.type === 'console');
  if (!log) log = (await api('POST', '/api/v1/channels', { name: 'Server-Log', type: 'console', config: {} })).channel;
  const { items: routes } = await api('GET', '/api/v1/routes');
  if (!routes.some((r) => r.name === 'Demo: alles ins Log')) {
    await api('POST', '/api/v1/routes', { name: 'Demo: alles ins Log', channels: [log.id], delivery: 'auto', digestMinutes: 1 });
  }
  console.log('✔ Topologie, Log-Kanal und Routing-Regel angelegt');
}

console.log('▶ API wirft 500er …');
for (let i = 0; i < 6; i++) {
  await send(
    Array.from({ length: 20 }, (_, j) => ({
      title: `HTTP 500 on /v1/chat after ${3000 + i * 20 + j} ms`,
      source: 'delta-ai',
      service: 'api',
      severity: 'high',
      host: 'api-1',
      labels: { env: 'prod' },
    })),
  );
  await sleep(150);
}
console.log('▶ Worker-Queue staut sich …');
await send(Array.from({ length: 40 }, (_, i) => ({ title: `Job queue stalled (${100 + i} jobs waiting)`, source: 'worker', service: 'worker', severity: 'warning' })));
await sleep(300);
console.log('▶ Ursache: Postgres nicht erreichbar');
await send({ title: 'Postgres connection refused 10.0.0.5:5432', source: 'uptime-kuma', service: 'postgres', severity: 'critical', ttl: 0 });

console.log('▶ GitHub: zwei Workflows für denselben Commit schlagen fehl');
await send([
  { title: 'Workflow „CI“ fehlgeschlagen (deltura/api@main)', source: 'github', service: 'api-repo', severity: 'high', correlationKey: 'github:deltura/api:abc1234', labels: { branch: 'main' } },
  { title: 'Workflow „E2E“ fehlgeschlagen (deltura/api@main)', source: 'github', service: 'api-repo', severity: 'high', correlationKey: 'github:deltura/api:abc1234', labels: { branch: 'main' } },
]);

console.log('▶ Unwichtiges für die Zusammenfassung');
await send([
  { title: 'Disk usage 85% on nas', source: 'node-exporter', service: 'nas', host: 'nas', severity: 'warning' },
  { title: 'Zertifikat für relay.example.com erneuert', source: 'certbot', service: 'proxy', severity: 'info' },
]);

console.log('▶ VPN flattert …');
for (let i = 0; i < 5; i++) {
  await send({ title: 'VPN tunnel to office down', source: 'wireguard', service: 'vpn', severity: 'high', fingerprint: 'demo-vpn' });
  await sleep(100);
  await send({ title: 'VPN tunnel to office down', source: 'wireguard', service: 'vpn', status: 'resolved', fingerprint: 'demo-vpn' });
  await sleep(100);
}

await sleep(1500);
const stats = await api('GET', '/api/v1/stats?hours=1');
const { items } = await api('GET', '/api/v1/incidents?status=open,acknowledged&limit=20');
console.log('\n━━ Ergebnis ━━');
console.log(`${stats.totals.events} Ereignisse → ${stats.totals.alerts} Alarme → ${stats.totals.incidents} Vorfälle → ${stats.totals.notifications} Benachrichtigungen bisher`);
for (const i of items) {
  console.log(`  #${i.number} [P${i.priority}] ${i.title}  (${i.alertCount} Alarme · ${i.eventCount} Ereignisse)${i.rootReason ? `\n      Ursache: ${i.rootReason}` : ''}`);
}
console.log(`\nDashboard: ${url}`);
