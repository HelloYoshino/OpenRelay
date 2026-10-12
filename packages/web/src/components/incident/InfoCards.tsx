import type { ReactNode } from 'react';
import type { Alert, Delivery, Incident } from '@openrelay/types';
import type { LinkView } from '../../lib/apiTypes';
import { policyCache, useChannelMap } from '../../lib/cache';
import { num, plural } from '../../lib/format';
import { NOTIFICATION_KIND_LABEL, labelOf } from '../../lib/labels';
import { incidentHref } from '../../lib/router';
import { Chip, DeliveryStatusBadge, FlappingBadge, LinkKindBadge, SeverityBadge, StatusBadge } from '../badges';
import { Icon } from '../Icon';
import { Card, EmptyState, KeyValue, RelTime } from '../ui';
import { ScoreBar } from './Timeline';

export function RootCause({ incident, alerts }: { incident: Incident; alerts: Alert[] }) {
  const root = alerts.find((a) => a.id === incident.rootAlertId);
  return (
    <Card
      title={
        <>
          <Icon name="target" size={15} /> Vermutete Ursache
        </>
      }
    >
      {!root && !incident.rootReason ? (
        <div className="muted">Noch keine Ursache ermittelt.</div>
      ) : (
        <div className="root-cause">
          {incident.rootReason ? (
            <div className="root-reason">
              <Icon name="info" size={16} />
              <div>{incident.rootReason}</div>
            </div>
          ) : null}
          {root ? (
            <div className="stack-sm">
              <div className="row">
                <SeverityBadge severity={root.severity} compact />
                <span className="root-alert-title">{root.title}</span>
                {root.flapping ? <FlappingBadge /> : null}
                {root.url ? (
                  <a href={root.url} target="_blank" rel="noreferrer noopener" className="small">
                    Quelle öffnen <Icon name="external" size={12} />
                  </a>
                ) : null}
              </div>
              <div className="list-meta">
                {root.service ? (
                  <span>
                    Service <Chip>{root.service}</Chip>
                  </span>
                ) : null}
                {root.host ? (
                  <span>
                    Host <Chip mono>{root.host}</Chip>
                  </span>
                ) : null}
                <span>
                  Quelle <Chip>{root.source}</Chip>
                </span>
                <span>{plural(root.count, 'Ereignis', 'Ereignisse')}</span>
              </div>
              {root.message ? <div className="message-text">{root.message}</div> : null}
            </div>
          ) : null}
        </div>
      )}
    </Card>
  );
}

export function DeliveriesCard({ deliveries }: { deliveries: Delivery[] }) {
  const channels = useChannelMap();
  const sorted = [...deliveries].sort((a, b) => b.createdAt - a.createdAt);
  return (
    <Card
      flush
      title={
        <>
          Zustellungen <span className="muted">· {deliveries.length}</span>
        </>
      }
    >
      {deliveries.length === 0 ? (
        <EmptyState title="Noch keine Zustellungen" icon="deliveries">
          Für diesen Vorfall wurde (noch) nichts versendet.
        </EmptyState>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Kanal</th>
                <th>Art</th>
                <th>Status</th>
                <th className="num">Versuche</th>
                <th>Zeit</th>
                <th>Letzter Fehler</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((d) => {
                const ch = channels.get(d.channelId);
                return (
                  <tr key={d.id}>
                    <td>
                      {ch ? ch.name : <span className="mono muted">{d.channelId}</span>}
                      {ch ? <span className="muted small"> · {ch.type}</span> : null}
                    </td>
                    <td>{labelOf(NOTIFICATION_KIND_LABEL, d.kind)}</td>
                    <td>
                      <DeliveryStatusBadge status={d.status} />
                    </td>
                    <td className="num">{num(d.attempts)}</td>
                    <td>
                      <RelTime ts={d.sentAt ?? d.createdAt} />
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
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

export function DetailsCard({ incident }: { incident: Incident }) {
  const policies = policyCache.use();
  const labels = Object.entries(incident.labels ?? {});
  const items: [string, ReactNode][] = [
    [
      'Services',
      incident.services.length ? (
        <span className="chips">
          {incident.services.map((s) => (
            <Chip key={s}>{s}</Chip>
          ))}
        </span>
      ) : (
        '–'
      ),
    ],
    [
      'Quellen',
      incident.sources.length ? (
        <span className="chips">
          {incident.sources.map((s) => (
            <Chip key={s}>{s}</Chip>
          ))}
        </span>
      ) : (
        '–'
      ),
    ],
  ];
  if (labels.length) {
    items.push([
      'Labels',
      <span className="chips" key="labels">
        {labels.map(([k, v]) => (
          <Chip key={k} mono>
            {k}={v}
          </Chip>
        ))}
      </span>,
    ]);
  }
  if (incident.correlationKey) items.push(['Korrelationsschlüssel', <span className="mono">{incident.correlationKey}</span>]);
  items.push(['Benachrichtigung', notifyStateLabel(incident)]);
  if (incident.escalationPolicyId) {
    const policy = policies?.find((p) => p.id === incident.escalationPolicyId);
    items.push([
      'Eskalation',
      <span>
        {policy ? `${policy.name} · ` : ''}
        {incident.escalationStep > 0 ? `Stufe ${incident.escalationStep}` : 'noch nicht eskaliert'}
        {incident.escalationCycle > 0 ? ` · Durchlauf ${incident.escalationCycle + 1}` : ''}
        {incident.escalationNextAt && incident.status === 'open' ? (
          <>
            {' · nächste Stufe '}
            <RelTime ts={incident.escalationNextAt} />
          </>
        ) : incident.status !== 'open' ? (
          ' · gestoppt'
        ) : null}
      </span>,
    ]);
  }
  items.push(['Letzte Aktivität', <RelTime ts={incident.lastActivityAt} />]);
  items.push(['ID', <span className="mono small">{incident.id}</span>]);
  return (
    <Card title="Details">
      <KeyValue items={items} />
    </Card>
  );
}

function notifyStateLabel(incident: Incident): string {
  switch (incident.notifyState) {
    case 'notified':
      return incident.notifiedChannels.length
        ? `Benachrichtigt (${plural(incident.notifiedChannels.length, 'Kanal', 'Kanäle')})`
        : 'Benachrichtigt';
    case 'pending':
      return 'Ausstehend (Digest/Verzögerung)';
    case 'suppressed':
      return 'Unterdrückt (Stummschaltung/Ruhezeit)';
    default:
      return 'Keine';
  }
}

export function LinksCard({ links }: { links: LinkView[] }) {
  return (
    <Card
      flush
      title={
        <>
          Verknüpfte Vorfälle <span className="muted">· {links.length}</span>
        </>
      }
    >
      {links.length === 0 ? (
        <div className="card-body muted small">Keine verwandten oder wiederkehrenden Vorfälle gefunden.</div>
      ) : (
        <div className="links-list">
          {links.map((l) => (
            <div className="link-item" key={`${l.relatedId}-${l.kind}`}>
              <div className="row">
                <LinkKindBadge kind={l.kind} />
                {l.score !== null && l.score !== undefined ? <ScoreBar score={l.score} /> : null}
                <span className="spacer" />
                <StatusBadge status={l.related.status} />
              </div>
              <a href={incidentHref(l.related.id)} className="row" style={{ gap: 6, flexWrap: 'nowrap', minWidth: 0 }}>
                <span className="muted">#{l.related.number}</span>
                <span className="truncate">{l.related.title}</span>
              </a>
              <div className="reason">
                {l.reason ? `${l.reason} · ` : ''}
                <RelTime ts={l.related.createdAt} prefix="erstellt" />
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
