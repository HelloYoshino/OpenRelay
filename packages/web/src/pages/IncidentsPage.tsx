import { useEffect, useRef, useState } from 'react';
import type { Incident, Severity } from '@openrelay/types';
import type { PagedResponse } from '../lib/apiTypes';
import { num } from '../lib/format';
import { useApi, useDebouncedCallback, useDebouncedValue } from '../lib/hooks';
import { SEVERITY_ORDER } from '../lib/labels';
import { incidentHref, navigate, useRoute } from '../lib/router';
import { useStreamEvent } from '../lib/stream';
import { Chip, PriorityBadge, RecurrenceBadge, SeverityBadge, StatusBadge, StormBadge } from '../components/badges';
import { SeveritySelect } from '../components/form';
import { Icon } from '../components/Icon';
import { AsyncBlock, Card, EmptyState, PageHeader, Pagination, RelTime, Tabs, type TabItem } from '../components/ui';

type TabKey = 'open' | 'acknowledged' | 'resolved' | 'all';

const TABS: TabItem<TabKey>[] = [
  { key: 'open', label: 'Offen' },
  { key: 'acknowledged', label: 'Bestätigt' },
  { key: 'resolved', label: 'Gelöst' },
  { key: 'all', label: 'Alle' },
];

const STATUS_PARAM: Record<TabKey, string | undefined> = {
  open: 'open,acknowledged',
  acknowledged: 'acknowledged',
  resolved: 'resolved',
  all: undefined,
};

const LIMIT = 50;

function parseTab(value: string | null): TabKey {
  if (value === 'acknowledged' || value === 'resolved' || value === 'all') return value;
  return 'open';
}

function parseSeverity(value: string | null): Severity | '' {
  return value && (SEVERITY_ORDER as string[]).includes(value) ? (value as Severity) : '';
}

export function IncidentsPage() {
  const route = useRoute();
  const tab = parseTab(route.query.get('status'));
  const severity = parseSeverity(route.query.get('severity'));
  const q = route.query.get('q') ?? '';
  const offset = Math.max(0, Number(route.query.get('offset')) || 0);

  const [search, setSearch] = useState(q);
  const debouncedSearch = useDebouncedValue(search, 300);

  const setParams = (next: { status?: TabKey; severity?: Severity | ''; q?: string; offset?: number }) => {
    const merged = { status: tab, severity, q, offset, ...next };
    navigate('/incidents', {
      replace: true,
      query: {
        status: merged.status === 'open' ? undefined : merged.status,
        severity: merged.severity || undefined,
        q: merged.q || undefined,
        offset: merged.offset || undefined,
      },
    });
  };

  // Push the debounced search text into the URL, and follow URL changes (back/forward).
  const lastQ = useRef(q);
  useEffect(() => {
    if (debouncedSearch !== lastQ.current) {
      lastQ.current = debouncedSearch;
      setParams({ q: debouncedSearch, offset: 0 });
    }
  }, [debouncedSearch]);
  useEffect(() => {
    if (q !== lastQ.current) {
      lastQ.current = q;
      setSearch(q);
    }
  }, [q]);

  const list = useApi<PagedResponse<Incident>>(
    '/incidents',
    { status: STATUS_PARAM[tab], severity: severity || undefined, q: q || undefined, limit: LIMIT, offset },
    { keepPrevious: true },
  );

  const [flashing, setFlashing] = useState<Record<string, number>>({});
  const reloadSoon = useDebouncedCallback(() => void list.reload(), 1500);

  useStreamEvent('incident', (incident) => {
    const found = !!list.data?.items.some((i) => i.id === incident.id);
    if (found) {
      list.setData((prev) => (prev ? { ...prev, items: prev.items.map((i) => (i.id === incident.id ? incident : i)) } : prev));
      setFlashing((f) => ({ ...f, [incident.id]: Date.now() }));
      setTimeout(() => {
        setFlashing((f) => {
          const next = { ...f };
          delete next[incident.id];
          return next;
        });
      }, 1700);
    }
    reloadSoon();
  });
  useStreamEvent('reconnected', reloadSoon);

  const filtersActive = !!(severity || q);

  return (
    <div className="page">
      <PageHeader title="Vorfälle" subtitle="Korrelierte Alarme, nach letzter Aktivität sortiert." />
      <Tabs label="Status" items={TABS} value={tab} onChange={(key) => setParams({ status: key, offset: 0 })} />
      <div className="filters">
        <div className="search">
          <Icon name="search" size={15} />
          <input
            className="input"
            type="search"
            placeholder="Suchen (Titel, Service, Quelle…)"
            aria-label="Vorfälle durchsuchen"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <SeveritySelect
          value={severity}
          onChange={(v) => setParams({ severity: v, offset: 0 })}
          allowEmpty
          ariaLabel="Nach Schweregrad filtern"
        />
        {filtersActive ? (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => {
              setSearch('');
              lastQ.current = '';
              setParams({ severity: '', q: '', offset: 0 });
            }}
          >
            <Icon name="x" size={14} /> Filter zurücksetzen
          </button>
        ) : null}
        <span className="spacer" />
        {list.data ? <span className="muted small">{num(list.data.total)} Vorfälle</span> : null}
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
              title={filtersActive ? 'Keine Treffer' : tab === 'open' ? 'Keine offenen Vorfälle' : 'Keine Vorfälle'}
              icon={filtersActive ? 'search' : 'checkCircle'}
            >
              {filtersActive
                ? 'Passe Suche oder Filter an.'
                : tab === 'open'
                  ? 'Alles ruhig – neue Vorfälle erscheinen hier live.'
                  : null}
            </EmptyState>
          }
        >
          {(data) => (
            <>
              <div className="table-wrap" style={list.stale ? { opacity: 0.6 } : undefined}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Schweregrad</th>
                      <th>Nr.</th>
                      <th>Vorfall</th>
                      <th>Prio</th>
                      <th>Umfang</th>
                      <th>Alter</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.items.map((inc) => (
                      <IncidentRow key={inc.id + (flashing[inc.id] ?? '')} incident={inc} flash={!!flashing[inc.id]} />
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination offset={offset} limit={LIMIT} total={data.total} onChange={(o) => setParams({ offset: o })} />
            </>
          )}
        </AsyncBlock>
      </Card>
    </div>
  );
}

function IncidentRow({ incident: inc, flash }: { incident: Incident; flash: boolean }) {
  const link = incidentHref(inc.id);
  return (
    <tr
      className={`clickable${flash ? ' flash' : ''}`}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('a, button, input, select')) return;
        if (window.getSelection()?.toString()) return; // allow selecting text
        window.location.hash = link;
      }}
    >
      <td>
        <SeverityBadge severity={inc.severity} />
      </td>
      <td className="num muted">#{inc.number}</td>
      <td className="wrap" style={{ minWidth: 280 }}>
        <div className="incident-title-cell">
          <a className="cell-title" href={link}>
            {inc.title}
          </a>
          {inc.services.length || inc.storm || inc.recurrenceCount > 0 ? (
            <div className="badges">
              {inc.storm ? <StormBadge /> : null}
              {inc.recurrenceCount > 0 ? <RecurrenceBadge count={inc.recurrenceCount} /> : null}
              {inc.services.slice(0, 4).map((s) => (
                <Chip key={s} title="Service">
                  {s}
                </Chip>
              ))}
              {inc.services.length > 4 ? <Chip>+{inc.services.length - 4}</Chip> : null}
            </div>
          ) : null}
        </div>
      </td>
      <td>
        <PriorityBadge priority={inc.priority} />
      </td>
      <td className="counts">
        {num(inc.alertCount)} {inc.alertCount === 1 ? 'Alarm' : 'Alarme'} · {num(inc.eventCount)}{' '}
        {inc.eventCount === 1 ? 'Ereignis' : 'Ereignisse'}
      </td>
      <td>
        <RelTime ts={inc.createdAt} />
      </td>
      <td>
        <StatusBadge status={inc.status} />
      </td>
    </tr>
  );
}
