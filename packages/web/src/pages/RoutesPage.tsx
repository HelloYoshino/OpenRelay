import { useMemo, useState } from 'react';
import type { Route } from '@openrelay/types';
import { api, errorText } from '../lib/api';
import type { ListResponse, SimulationResult } from '../lib/apiTypes';
import { policyCache, useChannelMap } from '../lib/cache';
import { useApi } from '../lib/hooks';
import { deliveryModeLabel } from '../lib/labels';
import { NO_WRITE_TITLE, useSession } from '../lib/session';
import { Badge, Chip } from '../components/badges';
import { Toggle } from '../components/form';
import { Icon } from '../components/Icon';
import { RouteEditor, routeInput } from '../components/routing/RouteEditor';
import { RouteSimulator } from '../components/routing/RouteSimulator';
import { useToast } from '../components/Toast';
import { AsyncBlock, Card, EmptyState, PageHeader } from '../components/ui';

export function RoutesPage() {
  const { canWrite } = useSession();
  const toast = useToast();
  const list = useApi<ListResponse<Route>>('/routes');
  const channels = useChannelMap();
  const policies = policyCache.use();
  const [editing, setEditing] = useState<Route | 'new' | null>(null);
  const [busy, setBusy] = useState(false);
  const [simulation, setSimulation] = useState<SimulationResult | null>(null);

  const routes = useMemo(() => [...(list.data?.items ?? [])].sort((a, b) => a.position - b.position), [list.data]);
  const matchedIds = useMemo(
    () => new Set(simulation?.routes.filter((r) => r.matched).map((r) => r.routeId) ?? []),
    [simulation],
  );
  const policyName = (id: string | null) => (id ? (policies?.find((p) => p.id === id)?.name ?? id) : null);

  const move = async (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= routes.length) return;
    const reordered = routes.slice();
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
    const updates = reordered
      .map((r, i) => ({ route: r, position: i + 1 }))
      .filter(({ route, position }) => route.position !== position);
    // optimistic
    list.setData((prev) => (prev ? { ...prev, items: reordered.map((r, i) => ({ ...r, position: i + 1 })) } : prev));
    setBusy(true);
    try {
      for (const { route, position } of updates) {
        await api.put<{ route: Route }>(`/routes/${encodeURIComponent(route.id)}`, { ...routeInput(route), position });
      }
    } catch (err) {
      toast.error(`Reihenfolge konnte nicht gespeichert werden: ${errorText(err)}`);
    } finally {
      setBusy(false);
      void list.reload();
    }
  };

  const toggleEnabled = async (route: Route, enabled: boolean) => {
    list.setData((prev) =>
      prev ? { ...prev, items: prev.items.map((r) => (r.id === route.id ? { ...r, enabled } : r)) } : prev,
    );
    try {
      await api.put<{ route: Route }>(`/routes/${encodeURIComponent(route.id)}`, { ...routeInput(route), enabled });
      toast.success(`„${route.name}“ ${enabled ? 'aktiviert' : 'deaktiviert'}.`);
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      void list.reload();
    }
  };

  const remove = async (route: Route) => {
    if (!window.confirm(`Routing-Regel „${route.name}“ wirklich löschen?`)) return;
    try {
      await api.del(`/routes/${encodeURIComponent(route.id)}`);
      toast.success('Regel gelöscht.');
      void list.reload();
    } catch (err) {
      toast.error(errorText(err));
    }
  };

  const nextPosition = routes.length ? Math.max(...routes.map((r) => r.position)) + 1 : 1;

  return (
    <div className="page">
      <PageHeader
        title="Routing"
        subtitle="Regeln entscheiden, welche Vorfälle an welche Kanäle gehen. Sie werden von oben nach unten ausgewertet."
        actions={
          <button
            type="button"
            className="btn btn-primary"
            disabled={!canWrite}
            title={canWrite ? undefined : NO_WRITE_TITLE}
            onClick={() => setEditing('new')}
          >
            <Icon name="plus" size={15} /> Neue Regel
          </button>
        }
      />
      <div className="routes-layout">
        <Card
          flush
          title={
            <>
              Regeln <span className="muted">· {routes.length}</span>
            </>
          }
        >
          <AsyncBlock
            data={list.data}
            error={list.error}
            loading={list.loading}
            onRetry={() => void list.reload()}
            isEmpty={(d) => d.items.length === 0}
            empty={
              <EmptyState
                title="Noch keine Routing-Regeln"
                icon="routing"
                action={
                  canWrite ? (
                    <button type="button" className="btn btn-primary btn-sm" onClick={() => setEditing('new')}>
                      <Icon name="plus" size={14} /> Erste Regel anlegen
                    </button>
                  ) : undefined
                }
              >
                Ohne Regeln wird niemand benachrichtigt. Lege z. B. „severity &gt;= high → Telegram“ an.
              </EmptyState>
            }
          >
            {() => (
              <div className="list">
                {routes.map((r, i) => (
                  <div key={r.id} className={`list-item${r.enabled ? '' : ' disabled'}`}>
                    <div className="position">
                      <button
                        type="button"
                        className="btn btn-ghost btn-xs btn-icon"
                        disabled={!canWrite || busy || i === 0}
                        onClick={() => void move(i, -1)}
                        aria-label={`„${r.name}“ nach oben`}
                        title="Nach oben"
                      >
                        <Icon name="up" size={14} />
                      </button>
                      <span className="position-num">{i + 1}</span>
                      <button
                        type="button"
                        className="btn btn-ghost btn-xs btn-icon"
                        disabled={!canWrite || busy || i === routes.length - 1}
                        onClick={() => void move(i, 1)}
                        aria-label={`„${r.name}“ nach unten`}
                        title="Nach unten"
                      >
                        <Icon name="down" size={14} />
                      </button>
                    </div>
                    <div className="list-main">
                      <div className="list-title">
                        {r.name}
                        {!r.enabled ? <Badge>deaktiviert</Badge> : null}
                        {r.stop ? (
                          <Badge tone="warning" title="Weitere Regeln werden nicht ausgewertet">
                            Stopp
                          </Badge>
                        ) : null}
                        {matchedIds.has(r.id) ? (
                          <Badge tone="ok">
                            <Icon name="check" size={12} /> Simulation trifft
                          </Badge>
                        ) : null}
                      </div>
                      <div className="matchers">
                        {r.matchers.length === 0 ? (
                          <span className="matcher">alles</span>
                        ) : (
                          r.matchers.map((m, idx) => (
                            <code key={idx} className="matcher" title={m}>
                              {m}
                            </code>
                          ))
                        )}
                      </div>
                      <div className="list-meta">
                        <span className="row" style={{ gap: 4 }}>
                          <Icon name="channels" size={13} />
                          {r.channels.length === 0 ? (
                            <span>keine Kanäle</span>
                          ) : (
                            r.channels.map((id) => <Chip key={id}>{channels.get(id)?.name ?? id}</Chip>)
                          )}
                        </span>
                        <span>
                          {deliveryModeLabel(r.delivery)}
                          {r.digestMinutes ? ` · ${r.digestMinutes} min` : ''}
                        </span>
                        {r.escalationPolicyId ? (
                          <span className="row" style={{ gap: 4 }}>
                            <Icon name="escalation" size={13} /> {policyName(r.escalationPolicyId)}
                          </span>
                        ) : null}
                        {r.quietHours ? (
                          <span className="row" style={{ gap: 4 }}>
                            <Icon name="moon" size={13} /> {r.quietHours.start}–{r.quietHours.end}
                            {r.quietHours.timezone ? ` (${r.quietHours.timezone})` : ''}
                          </span>
                        ) : null}
                        {r.notifyResolved ? <span>meldet Lösung</span> : null}
                      </div>
                    </div>
                    <div className="list-side">
                      <Toggle
                        checked={r.enabled}
                        disabled={!canWrite}
                        onChange={(v) => void toggleEnabled(r, v)}
                        title={r.enabled ? 'Regel deaktivieren' : 'Regel aktivieren'}
                      />
                      <button
                        type="button"
                        className="btn btn-sm btn-icon"
                        disabled={!canWrite}
                        onClick={() => setEditing(r)}
                        aria-label={`„${r.name}“ bearbeiten`}
                        title="Bearbeiten"
                      >
                        <Icon name="edit" size={14} />
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm btn-icon btn-danger"
                        disabled={!canWrite}
                        onClick={() => void remove(r)}
                        aria-label={`„${r.name}“ löschen`}
                        title="Löschen"
                      >
                        <Icon name="trash" size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </AsyncBlock>
        </Card>
        <RouteSimulator onResult={setSimulation} />
      </div>

      {editing ? (
        <RouteEditor
          route={editing === 'new' ? null : editing}
          nextPosition={nextPosition}
          onClose={() => setEditing(null)}
          onSaved={(saved) => {
            setEditing(null);
            toast.success(`Regel „${saved?.name ?? ''}“ gespeichert.`);
            void list.reload();
          }}
        />
      ) : null}
    </div>
  );
}
