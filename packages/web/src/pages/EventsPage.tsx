import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Severity, StoredEvent } from '@openrelay/types';
import { api, errorText, isAbort } from '../lib/api';
import type { ListResponse } from '../lib/apiTypes';
import { absTime } from '../lib/format';
import { useDebouncedValue } from '../lib/hooks';
import { SEVERITY_ORDER } from '../lib/labels';
import { incidentHref, useRoute } from '../lib/router';
import { useStreamEvent } from '../lib/stream';
import { ActionBadge, Chip, SeverityBadge } from '../components/badges';
import { SeveritySelect } from '../components/form';
import { Icon } from '../components/Icon';
import { Card, EmptyState, ErrorBox, KeyValue, Loading, PageHeader, RelTime, Spinner } from '../components/ui';

const LIMIT = 100;

export function EventsPage() {
  const route = useRoute();
  const [q, setQ] = useState(route.query.get('q') ?? '');
  const [source, setSource] = useState(route.query.get('source') ?? '');
  const initialSeverity = route.query.get('severity');
  const [severity, setSeverity] = useState<Severity | ''>(
    initialSeverity && (SEVERITY_ORDER as string[]).includes(initialSeverity) ? (initialSeverity as Severity) : '',
  );
  const dq = useDebouncedValue(q, 300);
  const dsource = useDebouncedValue(source, 300);

  const [items, setItems] = useState<StoredEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [newActivity, setNewActivity] = useState(0);
  const ctrlRef = useRef<AbortController | null>(null);

  const filters = useMemo(
    () => ({ q: dq || undefined, source: dsource || undefined, severity: severity || undefined }),
    [dq, dsource, severity],
  );

  const loadFirst = useCallback(async () => {
    ctrlRef.current?.abort();
    const ctrl = new AbortController();
    ctrlRef.current = ctrl;
    setRefreshing(true);
    setError(null);
    try {
      const res = await api.get<ListResponse<StoredEvent>>('/events', { ...filters, limit: LIMIT }, ctrl.signal);
      setItems(res.items ?? []);
      setHasMore((res.items ?? []).length >= LIMIT);
      setNewActivity(0);
    } catch (err) {
      if (!isAbort(err)) setError(errorText(err));
    } finally {
      if (ctrlRef.current === ctrl) setRefreshing(false);
    }
  }, [filters]);

  useEffect(() => {
    void loadFirst();
    return () => ctrlRef.current?.abort();
  }, [loadFirst]);

  const loadMore = async () => {
    if (!items || items.length === 0) return;
    const before = Math.min(...items.map((e) => e.receivedAt));
    setLoadingMore(true);
    setError(null);
    try {
      const res = await api.get<ListResponse<StoredEvent>>('/events', { ...filters, before, limit: LIMIT });
      const next = res.items ?? [];
      setItems((prev) => {
        const seen = new Set((prev ?? []).map((e) => e.id));
        return [...(prev ?? []), ...next.filter((e) => !seen.has(e.id))];
      });
      setHasMore(next.length >= LIMIT);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setLoadingMore(false);
    }
  };

  useStreamEvent('alert', () => setNewActivity((n) => n + 1));

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const filtersActive = !!(q || source || severity);

  return (
    <div className="page">
      <PageHeader
        title="Ereignisse"
        subtitle="Rohdaten aller eingegangenen Ereignisse und was die Pipeline damit gemacht hat."
        actions={
          <button type="button" className="btn btn-sm" onClick={() => void loadFirst()} disabled={refreshing}>
            <Icon name="refresh" size={14} /> {newActivity > 0 ? 'Neue Aktivität – aktualisieren' : 'Aktualisieren'}
          </button>
        }
      />
      <div className="filters">
        <div className="search">
          <Icon name="search" size={15} />
          <input
            className="input"
            type="search"
            placeholder="Suchen (Titel, Nachricht…)"
            aria-label="Ereignisse durchsuchen"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <input
          className="input"
          placeholder="Quelle"
          aria-label="Nach Quelle filtern"
          value={source}
          onChange={(e) => setSource(e.target.value)}
        />
        <SeveritySelect value={severity} onChange={setSeverity} allowEmpty ariaLabel="Nach Schweregrad filtern" />
        {filtersActive ? (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => {
              setQ('');
              setSource('');
              setSeverity('');
            }}
          >
            <Icon name="x" size={14} /> Zurücksetzen
          </button>
        ) : null}
        {refreshing && items ? <Spinner /> : null}
      </div>

      <Card flush>
        {items === null ? (
          error ? (
            <div className="card-body">
              <ErrorBox error={error} onRetry={() => void loadFirst()} />
            </div>
          ) : (
            <Loading />
          )
        ) : items.length === 0 ? (
          error ? (
            <div className="card-body">
              <ErrorBox error={error} onRetry={() => void loadFirst()} />
            </div>
          ) : (
            <EmptyState
              title={filtersActive ? 'Keine Treffer' : 'Noch keine Ereignisse'}
              icon={filtersActive ? 'search' : 'events'}
            >
              {filtersActive ? 'Passe Suche oder Filter an.' : 'Sende ein Ereignis an POST /api/v1/events, um loszulegen.'}
            </EmptyState>
          )
        ) : (
          <>
            {error ? (
              <div className="card-body">
                <ErrorBox error={error} compact />
              </div>
            ) : null}
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>
                      <span className="sr-only">Details</span>
                    </th>
                    <th>Zeit</th>
                    <th>Schweregrad</th>
                    <th>Quelle</th>
                    <th>Titel</th>
                    <th>Service</th>
                    <th>Aktion</th>
                    <th>Vorfall</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((ev) => {
                    const open = expanded.has(ev.id);
                    return (
                      <Fragment key={ev.id}>
                        <tr className={open ? 'row-expanded' : undefined}>
                          <td style={{ width: 32, paddingRight: 0 }}>
                            <button
                              type="button"
                              className="expander"
                              onClick={() => toggle(ev.id)}
                              aria-expanded={open}
                              aria-label={open ? 'Details ausblenden' : 'Details anzeigen'}
                            >
                              <Icon name={open ? 'down' : 'right'} size={14} />
                            </button>
                          </td>
                          <td>
                            <RelTime ts={ev.receivedAt} />
                          </td>
                          <td>
                            <SeverityBadge severity={ev.severity} compact />
                          </td>
                          <td>{ev.source}</td>
                          <td className="wrap">
                            <button
                              type="button"
                              className="expander cell-title"
                              style={{ textAlign: 'left', font: 'inherit', fontWeight: 500, color: 'var(--text)' }}
                              onClick={() => toggle(ev.id)}
                            >
                              {ev.title}
                            </button>
                            {ev.status === 'resolved' ? <span className="muted small"> · gelöst</span> : null}
                          </td>
                          <td>{ev.service ?? <span className="muted">–</span>}</td>
                          <td>
                            <ActionBadge action={ev.action} />
                          </td>
                          <td>
                            {ev.incidentId ? (
                              <a href={incidentHref(ev.incidentId)}>
                                Öffnen <Icon name="right" size={12} />
                              </a>
                            ) : (
                              <span className="muted">–</span>
                            )}
                          </td>
                        </tr>
                        {open ? (
                          <tr className="row-detail">
                            <td colSpan={8}>
                              <EventDetail event={ev} />
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {hasMore ? (
              <div className="load-more">
                <button type="button" className="btn btn-sm" onClick={() => void loadMore()} disabled={loadingMore}>
                  {loadingMore ? 'Lädt…' : 'Ältere laden'}
                </button>
              </div>
            ) : null}
          </>
        )}
      </Card>
    </div>
  );
}

function EventDetail({ event: ev }: { event: StoredEvent }) {
  const labels = Object.entries(ev.labels ?? {});
  let payload: string | null = null;
  if (ev.payload !== null && ev.payload !== undefined) {
    try {
      payload = typeof ev.payload === 'string' ? ev.payload : JSON.stringify(ev.payload, null, 2);
    } catch {
      payload = String(ev.payload);
    }
  }
  return (
    <div className="grid-2">
      <div className="stack-sm">
        <KeyValue
          items={[
            ['Zeitpunkt', absTime(ev.occurredAt)],
            ['Empfangen', absTime(ev.receivedAt)],
            ['Status', ev.status],
            ['Host', ev.host ?? '–'],
            ['Typ', ev.type ?? '–'],
            ['Fingerprint', <span className="mono small">{ev.fingerprint}</span>],
            ['Korrelationsschlüssel', ev.correlationKey ?? '–'],
            [
              'Labels',
              labels.length ? (
                <span className="chips">
                  {labels.map(([k, v]) => (
                    <Chip key={k} mono>
                      {k}={v}
                    </Chip>
                  ))}
                </span>
              ) : (
                '–'
              ),
            ],
            ...(ev.url
              ? ([
                  [
                    'Link',
                    <a href={ev.url} target="_blank" rel="noreferrer noopener">
                      {ev.url} <Icon name="external" size={12} />
                    </a>,
                  ],
                ] as [string, ReactNode][])
              : []),
            ['ID', <span className="mono small">{ev.id}</span>],
          ]}
        />
        {ev.message ? <div className="message-text">{ev.message}</div> : null}
      </div>
      <div className="stack-sm">
        <span className="section-title">Payload</span>
        {payload ? <pre>{payload}</pre> : <span className="muted small">Kein Payload.</span>}
      </div>
    </div>
  );
}
