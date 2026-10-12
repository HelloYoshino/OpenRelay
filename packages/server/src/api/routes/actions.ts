import type { FastifyInstance, FastifyReply } from 'fastify';
import { messages } from '../../engine/i18n.js';
import { incidentUrl } from '../../engine/message.js';
import { escapeHtml } from '../../plugins/format.js';
import type { AppContext } from '../server.js';

type Action = 'ack' | 'resolve';

function page(reply: FastifyReply, status: number, title: string, body: string): FastifyReply {
  return reply
    .status(status)
    .type('text/html; charset=utf-8')
    .header('cache-control', 'no-store')
    .header('referrer-policy', 'no-referrer')
    .send(`<!doctype html>
<html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>${escapeHtml(title)} · OpenRelay</title>
<style>
:root{color-scheme:light dark;--bg:#f6f7f9;--card:#fff;--fg:#111827;--muted:#6b7280;--accent:#2563eb}
@media (prefers-color-scheme:dark){:root{--bg:#0b0f17;--card:#141a24;--fg:#e5e7eb;--muted:#9ca3af;--accent:#60a5fa}}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;padding:16px;box-sizing:border-box}
main{background:var(--card);border-radius:12px;padding:28px;max-width:440px;width:100%;box-shadow:0 1px 3px rgba(0,0,0,.12)}
h1{font-size:20px;margin:0 0 8px}p{margin:0 0 16px;color:var(--muted)}
button,a.btn{display:inline-block;border:0;border-radius:8px;padding:10px 18px;font:inherit;font-weight:600;cursor:pointer;background:var(--accent);color:#fff;text-decoration:none}
a{color:var(--accent)}
</style></head><body><main>${body}</main></body></html>`);
}

export function registerActionRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { relay } = ctx;

  const handle = (confirmOnly: boolean) =>
    async (
      req: { params: { id: string; action: string }; query: unknown; headers: Record<string, unknown> },
      reply: FastifyReply,
    ) => {
      const t = messages(relay.settings().locale).page;
      const action = req.params.action as Action;
      const sig = String((req.query as Record<string, unknown>).sig ?? '');
      if ((action !== 'ack' && action !== 'resolve') || !relay.verify(req.params.id, action, sig)) {
        return page(reply, 403, t.invalid, `<h1>${escapeHtml(t.invalid)}</h1>`);
      }
      const incident = relay.store.getIncident(req.params.id);
      if (!incident) return page(reply, 404, t.notFound, `<h1>${escapeHtml(t.notFound)}</h1>`);
      const link = `<a href="${escapeHtml(incidentUrl(relay.publicUrl, incident.id))}">${escapeHtml(t.openDashboard)}</a>`;
      const heading = `#${incident.number} ${incident.title}`;
      const done = action === 'ack' ? incident.status !== 'open' : incident.status === 'resolved';
      const n = messages(relay.settings().locale).notify;
      const statusText = incident.status === 'resolved' ? n.statusResolved : n.statusAcknowledged;

      if (confirmOnly) {
        if (done) return page(reply, 200, t.done, `<h1>${escapeHtml(heading)}</h1><p>${escapeHtml(t.already(incident.number, statusText))}</p>${link}`);
        const title = action === 'ack' ? t.ackTitle : t.resolveTitle;
        const button = action === 'ack' ? t.confirmAck : t.confirmResolve;
        // GET only shows a form, so link previews of chat apps can't trigger the action.
        return page(
          reply,
          200,
          title,
          `<h1>${escapeHtml(title)}</h1><p>${escapeHtml(heading)}</p>
<form method="post"><button type="submit">${escapeHtml(button)}</button></form><p style="margin-top:16px">${link}</p>`,
        );
      }

      if (!done) {
        relay.store.tx(() => {
          if (action === 'ack') relay.incidents.acknowledge(incident, 'link', relay.clock.now());
          else relay.incidents.resolve(incident, 'link', relay.clock.now());
        });
        relay.deliveries.wake();
      }
      const accept = String(req.headers.accept ?? '');
      if (accept.includes('application/json') && !accept.includes('text/html')) {
        return reply.send({ ok: true, incident: relay.store.getIncident(incident.id) });
      }
      const msg = done ? t.already(incident.number, statusText) : action === 'ack' ? t.acked(incident.number) : t.resolvedMsg(incident.number);
      return page(reply, 200, t.done, `<h1>✅ ${escapeHtml(t.done)}</h1><p>${escapeHtml(msg)}</p>${link}`);
    };

  app.get<{ Params: { id: string; action: string } }>('/a/:id/:action', { config: { scope: 'public' } }, handle(true));
  app.post<{ Params: { id: string; action: string } }>('/a/:id/:action', { config: { scope: 'public' } }, handle(false));
}
