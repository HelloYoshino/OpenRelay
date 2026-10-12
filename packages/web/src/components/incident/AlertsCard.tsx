import { useState } from 'react';
import type { Alert, Incident } from '@openrelay/types';
import { api, errorText } from '../../lib/api';
import { num } from '../../lib/format';
import { navigate } from '../../lib/router';
import { NO_WRITE_TITLE, useSession } from '../../lib/session';
import { Badge, FlappingBadge, SeverityDot } from '../badges';
import { Icon } from '../Icon';
import { useToast } from '../Toast';
import { Card, EmptyState, RelTime } from '../ui';

export function AlertsCard({ alerts, incident }: { alerts: Alert[]; incident: Incident }) {
  const { canWrite, me } = useSession();
  const toast = useToast();
  const [busyId, setBusyId] = useState<string | null>(null);

  const detach = async (alert: Alert) => {
    if (
      !window.confirm(
        `Alarm „${alert.title}“ in einen eigenen Vorfall abtrennen?\nOpenRelay merkt sich diese Trennung für künftige Korrelationen.`,
      )
    )
      return;
    setBusyId(alert.id);
    try {
      const res = await api.post<{ incident: Incident }>(`/alerts/${encodeURIComponent(alert.id)}/detach`, { actor: me.name });
      toast.success(`Alarm abgetrennt – neuer Vorfall #${res.incident.number}.`);
      navigate(`/incidents/${encodeURIComponent(res.incident.id)}`);
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setBusyId(null);
    }
  };

  const sorted = [...alerts].sort((a, b) => {
    if (a.id === incident.rootAlertId) return -1;
    if (b.id === incident.rootAlertId) return 1;
    return b.lastSeen - a.lastSeen;
  });

  return (
    <Card
      flush
      title={
        <>
          Alarme <span className="muted">· {alerts.length}</span>
        </>
      }
    >
      {alerts.length === 0 ? (
        <EmptyState title="Keine Alarme" icon="layers" />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Alarm</th>
                <th>Service</th>
                <th>Host</th>
                <th>Quelle</th>
                <th className="num">Anzahl</th>
                <th>Status</th>
                <th>Zuerst</th>
                <th>Zuletzt</th>
                <th className="actions">
                  <span className="sr-only">Aktionen</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((a) => (
                <tr key={a.id}>
                  <td className="wrap">
                    <div className="incident-title-cell">
                      <span className="row" style={{ gap: 8, flexWrap: 'nowrap', alignItems: 'baseline' }}>
                        <SeverityDot severity={a.severity} />
                        <span className="cell-title">{a.title}</span>
                        {a.url ? (
                          <a
                            href={a.url}
                            target="_blank"
                            rel="noreferrer noopener"
                            title="Quelle öffnen"
                            aria-label="Quelle öffnen"
                          >
                            <Icon name="external" size={13} />
                          </a>
                        ) : null}
                      </span>
                      {a.id === incident.rootAlertId || a.flapping ? (
                        <div className="badges">
                          {a.id === incident.rootAlertId ? (
                            <Badge tone="accent">
                              <Icon name="target" size={12} /> Ursache
                            </Badge>
                          ) : null}
                          {a.flapping ? <FlappingBadge /> : null}
                        </div>
                      ) : null}
                    </div>
                  </td>
                  <td>{a.service ?? <span className="muted">–</span>}</td>
                  <td className="mono">{a.host ?? <span className="muted">–</span>}</td>
                  <td>{a.source}</td>
                  <td className="num">{num(a.count)}</td>
                  <td>
                    <Badge tone={a.status === 'firing' ? 'critical' : 'ok'} dot>
                      {a.status === 'firing' ? 'Aktiv' : 'Gelöst'}
                    </Badge>
                  </td>
                  <td>
                    <RelTime ts={a.firstSeen} />
                  </td>
                  <td>
                    <RelTime ts={a.lastSeen} />
                  </td>
                  <td className="actions">
                    <button
                      type="button"
                      className="btn btn-xs"
                      disabled={!canWrite || alerts.length < 2 || busyId !== null}
                      title={
                        !canWrite
                          ? NO_WRITE_TITLE
                          : alerts.length < 2
                            ? 'Einziger Alarm des Vorfalls'
                            : 'In eigenen Vorfall abtrennen'
                      }
                      onClick={() => void detach(a)}
                    >
                      <Icon name="detach" size={13} /> {busyId === a.id ? 'Trenne…' : 'Abtrennen'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
