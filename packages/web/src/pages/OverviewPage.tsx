import { useMemo, useState } from 'react';
import type { Incident, Severity } from '@openrelay/types';
import type { PagedResponse, Stats } from '../lib/apiTypes';
import { durationMinutes, num, percent, plural } from '../lib/format';
import { useApi, useDebouncedCallback, useInterval, type ApiState } from '../lib/hooks';
import { SEVERITY_LABEL, SEVERITY_ORDER } from '../lib/labels';
import { href, incidentHref } from '../lib/router';
import { useStreamEvent } from '../lib/stream';
import { NoiseChart, NoiseTable } from '../components/NoiseChart';
import { PriorityBadge, SeverityDot, StatusBadge } from '../components/badges';
import { Icon } from '../components/Icon';
import { Card, EmptyState, ErrorBox, Loading, PageHeader, RelTime } from '../components/ui';

const RANGES = [
  { hours: 6, label: '6 h' },
  { hours: 24, label: '24 h' },
  { hours: 168, label: '7 Tage' },
];

/** noiseReduction is expected as fraction 0..1; tolerate a percentage or a missing value. */
export function noiseFraction(stats: Stats): number | null {
  const v = stats.noiseReduction;
  if (typeof v === 'number' && Number.isFinite(v)) return Math.min(1, Math.max(0, v > 1 ? v / 100 : v));
  const { events, notifications } = stats.totals;
  return events > 0 ? Math.max(0, 1 - notifications / events) : null;
}

export function OverviewPage() {
  const [hours, setHours] = useState(24);
  const [log, setLog] = useState(false);
  const [showTable, setShowTable] = useState(false);
  const stats = useApi<Stats>('/stats', { hours }, { keepPrevious: true });
  const open = useApi<PagedResponse<Incident>>('/incidents', { status: 'open,acknowledged', limit: 100 });

  const refreshStats = useDebouncedCallback(() => void stats.reload(), 2500);
  const refreshOpen = useDebouncedCallback(() => void open.reload(), 1200);
  useStreamEvent('incident', () => {
    refreshOpen();
    refreshStats();
  });
  useStreamEvent('alert', refreshStats);
  useStreamEvent('delivery', refreshStats);
  useStreamEvent('reconnected', () => {
    refreshOpen();
    refreshStats();
  });
  useInterval(() => {
    void stats.reload();
    void open.reload();
  }, 30_000);

  const rangeLabel = RANGES.find((r) => r.hours === hours)?.label ?? `${hours} h`;

  return (
    <div className="page">
      <PageHeader
        title="Übersicht"
        subtitle="Was gerade passiert – und wie viel Lärm OpenRelay dir erspart."
        actions={
          <div className="segmented" role="group" aria-label="Zeitraum">
            {RANGES.map((r) => (
              <button key={r.hours} type="button" aria-pressed={hours === r.hours} onClick={() => setHours(r.hours)}>
                {r.label}
              </button>
            ))}
          </div>
        }
      />

      {stats.data === undefined ? (
        stats.error ? (
          <ErrorBox error={stats.error} onRetry={() => void stats.reload()} />
        ) : (
          <Loading />
        )
      ) : (
        <>
          {stats.error ? <ErrorBox error={stats.error} onRetry={() => void stats.reload()} compact /> : null}
          <Kpis stats={stats.data} rangeLabel={rangeLabel} />
          <Card
            title={
              <>
                Ereignisse vs. Benachrichtigungen <span className="muted">· {rangeLabel}</span>
              </>
            }
            actions={
              <>
                <div className="segmented" role="group" aria-label="Skalierung">
                  <button type="button" aria-pressed={!log} onClick={() => setLog(false)}>
                    Linear
                  </button>
                  <button type="button" aria-pressed={log} onClick={() => setLog(true)}>
                    Logarithmisch
                  </button>
                </div>
                <button type="button" className="btn btn-sm" aria-pressed={showTable} onClick={() => setShowTable((s) => !s)}>
                  {showTable ? 'Diagramm' : 'Tabelle'}
                </button>
              </>
            }
          >
            <div className="stack">
              <NoiseSummary stats={stats.data} />
              {stats.data.eventsSeries.length === 0 && stats.data.notificationsSeries.length === 0 ? (
                <EmptyState title="Noch keine Daten" icon="events">
                  Sobald Ereignisse eintreffen, erscheint hier der Verlauf.
                </EmptyState>
              ) : showTable ? (
                <NoiseTable events={stats.data.eventsSeries} notifications={stats.data.notificationsSeries} />
              ) : (
                <NoiseChart
                  events={stats.data.eventsSeries}
                  notifications={stats.data.notificationsSeries}
                  log={log}
                  loading={stats.stale}
                  bucketMinutes={stats.data.bucketMinutes}
                />
              )}
            </div>
          </Card>
        </>
      )}

      <div className="overview-grid">
        <OpenIncidents state={open} />
        {stats.data ? <TopSources stats={stats.data} rangeLabel={rangeLabel} /> : null}
      </div>
    </div>
  );
}

function Kpis({ stats, rangeLabel }: { stats: Stats; rangeLabel: string }) {
  const noise = noiseFraction(stats);
  return (
    <div className="kpis">
      <a
        className={`kpi${stats.incidents.open > 0 ? ' accent-critical' : ' accent-ok'}`}
        href={href('/incidents', { status: 'open' })}
      >
        <span className="kpi-label">
          <Icon name="incident" size={14} /> Offene Vorfälle
        </span>
        <span className="kpi-value">{num(stats.incidents.open)}</span>
        <span className="kpi-sub">{stats.incidents.open === 0 ? 'Alles ruhig' : 'unbestätigt'}</span>
      </a>
      <a
        className={`kpi${stats.incidents.acknowledged > 0 ? ' accent-warning' : ''}`}
        href={href('/incidents', { status: 'acknowledged' })}
      >
        <span className="kpi-label">
          <Icon name="check" size={14} /> Bestätigt
        </span>
        <span className="kpi-value">{num(stats.incidents.acknowledged)}</span>
        <span className="kpi-sub">in Bearbeitung</span>
      </a>
      <div className="kpi accent-brand">
        <span className="kpi-label">
          <Icon name="filter" size={14} /> Rauschunterdrückung
        </span>
        <span className="kpi-value">{percent(noise, 1)}</span>
        <span className="kpi-sub">
          {num(stats.totals.events)} Ereignisse → {num(stats.totals.notifications)} Benachrichtigungen
        </span>
      </div>
      <div className="kpi">
        <span className="kpi-label">
          <Icon name="clock" size={14} /> MTTA
        </span>
        <span className="kpi-value">{durationMinutes(stats.mttaMinutes)}</span>
        <span className="kpi-sub">Ø bis zur Bestätigung · {rangeLabel}</span>
      </div>
      <div className="kpi">
        <span className="kpi-label">
          <Icon name="checkCircle" size={14} /> MTTR
        </span>
        <span className="kpi-value">{durationMinutes(stats.mttrMinutes)}</span>
        <span className="kpi-sub">Ø bis zur Lösung · {rangeLabel}</span>
      </div>
      <a
        className={`kpi${stats.queue.failed > 0 ? ' accent-critical' : ''}`}
        href={href('/deliveries', stats.queue.failed > 0 ? { status: 'failed' } : undefined)}
      >
        <span className="kpi-label">
          <Icon name="deliveries" size={14} /> Warteschlange
        </span>
        <span className="kpi-value">
          {num(stats.queue.pending)}
          <span className="unit">wartend</span>
        </span>
        <span className="kpi-sub">{stats.queue.failed > 0 ? `${num(stats.queue.failed)} fehlgeschlagen` : 'keine Fehler'}</span>
      </a>
    </div>
  );
}

function NoiseSummary({ stats }: { stats: Stats }) {
  const noise = noiseFraction(stats);
  const { events, alerts, incidents, notifications } = stats.totals;
  return (
    <div className="row-between">
      <div className="noise-hero">
        <span className="big num">{plural(events, 'Ereignis', 'Ereignisse')}</span>
        <span className="noise-arrow">→</span>
        <span className="num">{plural(alerts, 'Alarm', 'Alarme')}</span>
        <span className="noise-arrow">→</span>
        <span className="num">{plural(incidents, 'Vorfall', 'Vorfälle')}</span>
        <span className="noise-arrow">→</span>
        <span className="big num">{plural(notifications, 'Benachrichtigung', 'Benachrichtigungen')}</span>
        {noise !== null ? <span className="muted">({percent(noise, 1)} weniger Lärm)</span> : null}
      </div>
      <div className="chart-legend" aria-label="Legende">
        <span className="legend-item">
          <span className="legend-swatch" style={{ background: 'var(--chart-events)' }} />
          Ereignisse <span className="legend-value">{num(events)}</span>
        </span>
        <span className="legend-item">
          <span className="legend-swatch" style={{ background: 'var(--chart-notifs)' }} />
          Benachrichtigungen <span className="legend-value">{num(notifications)}</span>
        </span>
      </div>
    </div>
  );
}

function OpenIncidents({ state }: { state: ApiState<PagedResponse<Incident>> }) {
  const groups = useMemo(() => {
    const items = state.data?.items ?? [];
    const bySev = new Map<Severity, Incident[]>();
    for (const inc of items) {
      const list = bySev.get(inc.severity) ?? [];
      list.push(inc);
      bySev.set(inc.severity, list);
    }
    return SEVERITY_ORDER.filter((s) => bySev.has(s)).map((s) => ({
      severity: s,
      items: (bySev.get(s) ?? []).sort((a, b) => a.priority - b.priority || b.lastActivityAt - a.lastActivityAt),
    }));
  }, [state.data]);

  const total = state.data?.total ?? 0;

  return (
    <Card
      flush
      title={<>Offene Vorfälle {state.data ? <span className="muted">· {num(total)}</span> : null}</>}
      actions={
        <a className="btn btn-sm btn-ghost" href={href('/incidents')}>
          Alle anzeigen <Icon name="right" size={14} />
        </a>
      }
    >
      {state.data === undefined ? (
        state.error ? (
          <div className="card-body">
            <ErrorBox error={state.error} onRetry={() => void state.reload()} />
          </div>
        ) : (
          <Loading />
        )
      ) : groups.length === 0 ? (
        <EmptyState title="Keine offenen Vorfälle" icon="checkCircle">
          Alles ruhig. Neue Vorfälle erscheinen hier live.
        </EmptyState>
      ) : (
        <>
          <div style={{ padding: '12px 16px 10px' }}>
            <div className="sev-strip" aria-hidden>
              {groups.map((g) => (
                <span
                  key={g.severity}
                  className={`sev-${g.severity}`}
                  style={{ flex: g.items.length }}
                  title={`${SEVERITY_LABEL[g.severity]}: ${g.items.length}`}
                />
              ))}
            </div>
          </div>
          <div className="incident-list">
            {groups.map((g) => (
              <div key={g.severity}>
                <div className="incident-group-title">
                  <SeverityDot severity={g.severity} />
                  {SEVERITY_LABEL[g.severity]} · {g.items.length}
                </div>
                {g.items.map((inc) => (
                  <a key={inc.id} className="incident-item" href={incidentHref(inc.id)}>
                    <span className="num-col">#{inc.number}</span>
                    <PriorityBadge priority={inc.priority} />
                    <span className="title-col">
                      <span className="truncate">{inc.title}</span>
                      <span className="meta truncate">
                        {inc.services.length ? inc.services.join(', ') : inc.sources.join(', ')} ·{' '}
                        {plural(inc.alertCount, 'Alarm', 'Alarme')}
                      </span>
                    </span>
                    <span className="right">
                      {inc.status === 'acknowledged' ? <StatusBadge status={inc.status} /> : null}
                      <RelTime ts={inc.createdAt} />
                    </span>
                  </a>
                ))}
              </div>
            ))}
          </div>
          {total > (state.data.items?.length ?? 0) ? (
            <div className="load-more">
              <a className="btn btn-sm" href={href('/incidents')}>
                {num(total - state.data.items.length)} weitere anzeigen
              </a>
            </div>
          ) : null}
        </>
      )}
    </Card>
  );
}

function TopSources({ stats, rangeLabel }: { stats: Stats; rangeLabel: string }) {
  const sources = stats.topSources ?? [];
  const max = Math.max(1, ...sources.map((s) => s.count));
  return (
    <Card
      title={
        <>
          Top-Quellen <span className="muted">· Ereignisse, {rangeLabel}</span>
        </>
      }
    >
      {sources.length === 0 ? (
        <EmptyState title="Keine Quellen" icon="events">
          Im gewählten Zeitraum sind keine Ereignisse eingegangen.
        </EmptyState>
      ) : (
        <div className="bars">
          {sources.map((s) => (
            <a key={s.source} className="hbar" href={href('/events', { source: s.source })} style={{ color: 'inherit' }}>
              <span className="truncate">{s.source}</span>
              <span className="num">{num(s.count)}</span>
              <span className="hbar-track">
                <span className="hbar-fill" style={{ width: `${(s.count / max) * 100}%`, display: 'block' }} />
              </span>
            </a>
          ))}
        </div>
      )}
    </Card>
  );
}
