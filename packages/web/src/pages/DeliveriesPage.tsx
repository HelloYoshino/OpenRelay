import { useState } from 'react';
import type { Delivery, DeliveryStatus } from '@openrelay/types';
import { api, errorText } from '../lib/api';
import type { ListResponse } from '../lib/apiTypes';
import { channelCache } from '../lib/cache';
import { num } from '../lib/format';
import { useApi, useDebouncedCallback } from '../lib/hooks';
import { DELIVERY_STATUS_LABEL, NOTIFICATION_KIND_LABEL, labelOf } from '../lib/labels';
import { incidentHref, navigate, useRoute } from '../lib/router';
import { NO_WRITE_TITLE, useSession } from '../lib/session';
import { useStreamEvent } from '../lib/stream';
import { DeliveryStatusBadge } from '../components/badges';
import { Icon } from '../components/Icon';
import { useToast } from '../components/Toast';
import { AsyncBlock, Card, EmptyState, PageHeader, RelTime } from '../components/ui';

const STATUSES: DeliveryStatus[] = ['pending', 'sending', 'sent', 'failed'];
const LIMIT = 200;

export function DeliveriesPage() {
  const { canWrite } = useSession();
  const toast = useToast();
  const route = useRoute();
  const statusParam = route.query.get('status');
  const status = statusParam && (STATUSES as string[]).includes(statusParam) ? (statusParam as DeliveryStatus) : '';
  const channelId = route.query.get('channel') ?? '';
  const channels = channelCache.use();
  const channelMap = new Map((channels ?? []).map((c) => [c.id, c]));

  const list = useApi<ListResponse<Delivery>>(
    '/deliveries',
    { status: status || undefined, channelId: channelId || undefined, limit: LIMIT },
    { keepPrevious: true },
  );
  const [retrying, setRetrying] = useState<number | null>(null);
  const reloadSoon = useDebouncedCallback(() => void list.reload(), 1200);

  const setFilter = (next: { status?: string; channel?: string }) =>
    navigate('/deliveries', {
      replace: true,
      query: { status: (next.status ?? status) || undefined, channel: (next.channel ?? channelId) || undefined },
    });

  useStreamEvent('delivery', (ev) => {
    const known = list.data?.items.some((d) => d.id === ev.id);
    if (known) {
      list.setData((prev) =>
        prev
          ? { ...prev, items: prev.items.map((d) => (d.id === ev.id ? { ...d, status: ev.status, updatedAt: Date.now() } : d)) }
          : prev,
      );
    }
    reloadSoon();
  });
  useStreamEvent('reconnected', reloadSoon);

  const retry = async (d: Delivery) => {
    setRetrying(d.id);
    try {
      await api.post(`/deliveries/${d.id}/retry`);
      toast.success('Zustellung wird erneut versucht.');
      list.setData((prev) =>
        prev ? { ...prev, items: prev.items.map((x) => (x.id === d.id ? { ...x, status: 'pending' } : x)) } : prev,
      );
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setRetrying(null);
      reloadSoon();
    }
  };

  const filtered = !!(status || channelId);

  return (
    <div className="page">
      <PageHeader
        title="Zustellungen"
        subtitle="Jede versendete (oder wartende) Benachrichtigung mit Versuchen und Fehlern."
        actions={
          <button type="button" className="btn btn-sm" onClick={() => void list.reload()}>
            <Icon name="refresh" size={14} /> Aktualisieren
          </button>
        }
      />
      <div className="filters">
        <select
          className="input"
          value={status}
          onChange={(e) => setFilter({ status: e.target.value })}
          aria-label="Nach Status filtern"
        >
          <option value="">Alle Status</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {DELIVERY_STATUS_LABEL[s]}
            </option>
          ))}
        </select>
        <select
          className="input"
          value={channelId}
          onChange={(e) => setFilter({ channel: e.target.value })}
          aria-label="Nach Kanal filtern"
        >
          <option value="">Alle Kanäle</option>
          {(channels ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        {filtered ? (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setFilter({ status: '', channel: '' })}>
            <Icon name="x" size={14} /> Zurücksetzen
          </button>
        ) : null}
      </div>
      <Card flush>
        <AsyncBlock
          data={list.data}
          error={list.error}
          loading={list.loading}
          onRetry={() => void list.reload()}
          isEmpty={(d) => d.items.length === 0}
          empty={
            <EmptyState
              title={filtered ? 'Keine Treffer' : 'Noch keine Zustellungen'}
              icon={status === 'failed' ? 'checkCircle' : 'deliveries'}
            >
              {status === 'failed' ? 'Keine fehlgeschlagenen Zustellungen.' : null}
            </EmptyState>
          }
        >
          {(data) => (
            <div className="table-wrap" style={list.stale ? { opacity: 0.6 } : undefined}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Erstellt</th>
                    <th>Kanal</th>
                    <th>Art</th>
                    <th>Vorfall</th>
                    <th>Status</th>
                    <th className="num">Versuche</th>
                    <th>Nächster Versuch</th>
                    <th>Letzter Fehler</th>
                    <th className="actions">
                      <span className="sr-only">Aktionen</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {[...data.items]
                    .sort((a, b) => b.createdAt - a.createdAt)
                    .map((d) => {
                      const ch = channelMap.get(d.channelId);
                      const inc = d.message?.incident;
                      return (
                        <tr key={d.id}>
                          <td>
                            <RelTime ts={d.createdAt} />
                          </td>
                          <td>
                            {ch ? ch.name : <span className="mono muted">{d.channelId}</span>}
                            {ch ? <span className="muted small"> · {ch.type}</span> : null}
                          </td>
                          <td>{labelOf(NOTIFICATION_KIND_LABEL, d.kind)}</td>
                          <td>
                            {d.incidentId ? (
                              <a
                                href={incidentHref(d.incidentId)}
                                title={d.message?.title}
                                className="truncate"
                                style={{ display: 'inline-block', maxWidth: 280, verticalAlign: 'bottom' }}
                              >
                                {inc ? `#${inc.number} ${inc.title}` : (d.message?.title ?? 'Vorfall öffnen')}
                              </a>
                            ) : (
                              <span className="muted">{d.message?.title ?? '–'}</span>
                            )}
                          </td>
                          <td>
                            <DeliveryStatusBadge status={d.status} />
                          </td>
                          <td className="num">{num(d.attempts)}</td>
                          <td>
                            {d.status === 'pending' || d.status === 'failed' ? (
                              <RelTime ts={d.nextAttemptAt} />
                            ) : (
                              <span className="muted">–</span>
                            )}
                          </td>
                          <td>
                            {d.lastError ? (
                              <span className="error-text" title={d.lastError}>
                                {d.lastError}
                              </span>
                            ) : (
                              <span className="muted">–</span>
                            )}
                          </td>
                          <td className="actions">
                            {d.status === 'failed' ? (
                              <button
                                type="button"
                                className="btn btn-xs"
                                disabled={!canWrite || retrying !== null}
                                title={canWrite ? 'Zustellung erneut versuchen' : NO_WRITE_TITLE}
                                onClick={() => void retry(d)}
                              >
                                <Icon name="refresh" size={12} /> {retrying === d.id ? 'Sende…' : 'Erneut senden'}
                              </button>
                            ) : null}
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          )}
        </AsyncBlock>
      </Card>
      {list.data && list.data.items.length >= LIMIT ? (
        <p className="muted small">Es werden die neuesten {LIMIT} Zustellungen angezeigt.</p>
      ) : null}
    </div>
  );
}
