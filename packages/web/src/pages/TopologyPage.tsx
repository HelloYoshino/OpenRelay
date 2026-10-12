import { useEffect, useId, useMemo, useState } from 'react';
import type { ServiceDependency } from '@openrelay/types';
import type { TopologyResponse } from '../lib/apiTypes';
import { api } from '../lib/api';
import { useAction, useApi } from '../lib/hooks';
import { NO_WRITE_TITLE, useSession } from '../lib/session';
import { Icon } from '../components/Icon';
import { TopologyGraph } from '../components/TopologyGraph';
import { useToast } from '../components/Toast';
import { Card, EmptyState, ErrorBox, FormError, Hint, Loading, PageHeader } from '../components/ui';

type Row = ServiceDependency & { key: number };

let rowKey = 1;
const toRows = (items: ServiceDependency[]): Row[] => items.map((d) => ({ ...d, key: rowKey++ }));

function normalize(rows: Row[]): ServiceDependency[] {
  const seen = new Set<string>();
  const out: ServiceDependency[] = [];
  for (const r of rows) {
    const service = r.service.trim();
    const dependsOn = r.dependsOn.trim();
    if (!service || !dependsOn || service.toLowerCase() === dependsOn.toLowerCase()) continue;
    const k = `${service}\u0000${dependsOn}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ service, dependsOn });
  }
  return out;
}

export function TopologyPage() {
  const { canWrite } = useSession();
  const toast = useToast();
  const topo = useApi<TopologyResponse>('/topology');
  const [rows, setRows] = useState<Row[] | null>(null);
  const action = useAction();
  const listId = useId();

  useEffect(() => {
    if (topo.data && rows === null) setRows(toRows(topo.data.items ?? []));
  }, [topo.data, rows]);

  const current = useMemo(() => normalize(rows ?? []), [rows]);
  const saved = useMemo(() => normalize(toRows(topo.data?.items ?? [])), [topo.data]);
  const dirty = JSON.stringify(current) !== JSON.stringify(saved);

  const suggestions = useMemo(() => {
    const set = new Set<string>(topo.data?.services ?? []);
    for (const r of rows ?? []) {
      if (r.service.trim()) set.add(r.service.trim());
      if (r.dependsOn.trim()) set.add(r.dependsOn.trim());
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [topo.data, rows]);

  const update = (key: number, patch: Partial<ServiceDependency>) =>
    setRows((rs) => (rs ?? []).map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const save = async () => {
    const res = await action.run(() => api.put<TopologyResponse>('/topology', { items: current }));
    if (res.ok) {
      toast.success('Topologie gespeichert.');
      const items = res.value?.items ?? current;
      topo.setData((prev) => ({ items, services: res.value?.services ?? prev?.services ?? [] }));
      setRows(toRows(items));
    }
  };

  return (
    <div className="page">
      <PageHeader
        title="Topologie"
        subtitle="Welche Services hängen voneinander ab? OpenRelay nutzt das, um zusammengehörige Alarme zu bündeln und die eigentliche Ursache zu erkennen."
      />
      <Hint icon="target">
        Beispiel: <code>api</code> hängt ab von <code>postgres</code>. Fallen beide gleichzeitig aus, landen die Alarme in einem
        Vorfall – und <code>postgres</code> wird als vermutete Ursache markiert, statt dass du zwei getrennte Benachrichtigungen
        bekommst.
      </Hint>

      {rows === null ? (
        topo.error ? (
          <ErrorBox error={topo.error} onRetry={() => void topo.reload()} />
        ) : (
          <Loading />
        )
      ) : (
        <div className="grid-2" style={{ alignItems: 'start' }}>
          <Card
            title={
              <>
                Abhängigkeiten <span className="muted">· {current.length}</span>
              </>
            }
            actions={
              dirty ? (
                <span className="small muted">
                  <Icon name="edit" size={12} /> Ungespeicherte Änderungen
                </span>
              ) : null
            }
          >
            <form
              className="stack"
              onSubmit={(e) => {
                e.preventDefault();
                void save();
              }}
            >
              {rows.length === 0 ? (
                <div className="muted small">Noch keine Abhängigkeiten definiert.</div>
              ) : (
                <div className="topo-rows">
                  <div className="topo-head" aria-hidden>
                    <span>Service</span>
                    <span>→</span>
                    <span>hängt ab von</span>
                    <span />
                  </div>
                  {rows.map((r) => {
                    const invalid =
                      (r.service.trim() !== '' || r.dependsOn.trim() !== '') &&
                      (!r.service.trim() ||
                        !r.dependsOn.trim() ||
                        r.service.trim().toLowerCase() === r.dependsOn.trim().toLowerCase());
                    return (
                      <div key={r.key} className={`topo-row${invalid ? ' invalid' : ''}`}>
                        <input
                          className="input mono"
                          value={r.service}
                          list={listId}
                          placeholder="z. B. api"
                          aria-label="Service"
                          disabled={!canWrite}
                          onChange={(e) => update(r.key, { service: e.target.value })}
                        />
                        <span className="arrow" aria-hidden>
                          →
                        </span>
                        <input
                          className="input mono"
                          value={r.dependsOn}
                          list={listId}
                          placeholder="z. B. postgres"
                          aria-label="hängt ab von"
                          disabled={!canWrite}
                          onChange={(e) => update(r.key, { dependsOn: e.target.value })}
                        />
                        <button
                          type="button"
                          className="btn btn-icon btn-ghost"
                          disabled={!canWrite}
                          onClick={() => setRows((rs) => (rs ?? []).filter((x) => x.key !== r.key))}
                          aria-label="Abhängigkeit entfernen"
                          title="Entfernen"
                        >
                          <Icon name="x" size={14} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
              <datalist id={listId}>
                {suggestions.map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>
              <div className="row-between">
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={!canWrite}
                  onClick={() => setRows((rs) => [...(rs ?? []), { service: '', dependsOn: '', key: rowKey++ }])}
                >
                  <Icon name="plus" size={14} /> Abhängigkeit
                </button>
                <div className="row">
                  {dirty ? (
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost"
                      onClick={() => setRows(toRows(topo.data?.items ?? []))}
                    >
                      Verwerfen
                    </button>
                  ) : null}
                  <button
                    type="submit"
                    className="btn btn-sm btn-primary"
                    disabled={!canWrite || !dirty || action.busy}
                    title={canWrite ? undefined : NO_WRITE_TITLE}
                  >
                    {action.busy ? 'Speichere…' : 'Speichern'}
                  </button>
                </div>
              </div>
              <FormError error={action.error} />
              {topo.data?.services?.length ? (
                <p className="muted small">Vorschläge stammen aus {topo.data.services.length} bisher gesehenen Services.</p>
              ) : null}
            </form>
          </Card>
          <Card
            title="Graph"
            actions={
              current.length ? (
                <span className="small muted row" style={{ gap: 6 }}>
                  <span
                    className="legend-swatch"
                    style={{
                      background: 'color-mix(in srgb, var(--accent) 25%, var(--surface))',
                      border: '1px solid var(--accent)',
                    }}
                  />
                  Basis-Dienste
                </span>
              ) : null
            }
          >
            {current.length === 0 ? (
              <EmptyState title="Noch kein Graph" icon="topology">
                Füge links Abhängigkeiten hinzu – der Graph aktualisiert sich sofort.
              </EmptyState>
            ) : (
              <div className="stack-sm">
                <TopologyGraph deps={current} />
                <p className="muted small">
                  Pfeile zeigen auf die Abhängigkeit. Unten stehen Basis-Dienste ohne eigene Abhängigkeiten – typische Ursachen.
                </p>
              </div>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
