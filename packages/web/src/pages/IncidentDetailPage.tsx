import type { Incident } from '@openrelay/types';
import type { IncidentDetail } from '../lib/apiTypes';
import { useApi, useDebouncedCallback } from '../lib/hooks';
import { href } from '../lib/router';
import { useStreamEvent } from '../lib/stream';
import { Icon } from '../components/Icon';
import { AlertsCard } from '../components/incident/AlertsCard';
import { DetailHeader } from '../components/incident/DetailHeader';
import { DeliveriesCard, DetailsCard, LinksCard, RootCause } from '../components/incident/InfoCards';
import { Timeline } from '../components/incident/Timeline';
import { Card, ErrorBox, Loading } from '../components/ui';

export function IncidentDetailPage({ id }: { id: string }) {
  const detail = useApi<IncidentDetail>(`/incidents/${encodeURIComponent(id)}`);
  const reloadSoon = useDebouncedCallback(() => void detail.reload(), 800);

  useStreamEvent('incident', (incident) => {
    if (incident.id !== id) return;
    detail.setData((prev) => (prev ? { ...prev, incident } : prev));
    reloadSoon();
  });
  useStreamEvent('alert', (alert) => {
    if (alert.incidentId === id || detail.data?.alerts.some((a) => a.id === alert.id)) reloadSoon();
  });
  useStreamEvent('delivery', (d) => {
    if (d.incidentId === id) reloadSoon();
  });
  useStreamEvent('reconnected', reloadSoon);

  if (detail.data === undefined) {
    return (
      <div className="page">
        <BackLink />
        {detail.error ? <ErrorBox error={detail.error} onRetry={() => void detail.reload()} /> : <Loading />}
      </div>
    );
  }

  const data = detail.data;
  const setIncident = (incident: Incident) => {
    detail.setData((prev) => (prev ? { ...prev, incident } : prev));
    void detail.reload();
  };

  return (
    <div className="page">
      <BackLink />
      {detail.error ? <ErrorBox error={detail.error} onRetry={() => void detail.reload()} compact /> : null}
      <DetailHeader data={data} onIncident={setIncident} />
      <div className="detail-grid">
        <div className="stack">
          <RootCause incident={data.incident} alerts={data.alerts} />
          <AlertsCard alerts={data.alerts} incident={data.incident} />
          <DeliveriesCard deliveries={data.deliveries} />
        </div>
        <div className="stack">
          <DetailsCard incident={data.incident} />
          <LinksCard links={data.links} />
          <Card title="Zeitachse">
            <Timeline
              incidentId={data.incident.id}
              entries={data.timeline}
              onCommented={(entry) => {
                if (entry) detail.setData((prev) => (prev ? { ...prev, timeline: [...prev.timeline, entry] } : prev));
                void detail.reload();
              }}
            />
          </Card>
        </div>
      </div>
    </div>
  );
}

function BackLink() {
  return (
    <div>
      <a className="btn btn-ghost btn-sm" href={href('/incidents')} style={{ marginLeft: -8 }}>
        <Icon name="left" size={14} /> Vorfälle
      </a>
    </div>
  );
}
