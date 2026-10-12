import { useState } from 'react';
import type { Incident } from '@openrelay/types';
import { api, errorText } from '../../lib/api';
import type { IncidentDetail } from '../../lib/apiTypes';
import { num, plural } from '../../lib/format';
import { navigate } from '../../lib/router';
import { NO_WRITE_TITLE, useSession } from '../../lib/session';
import { PriorityBadge, RecurrenceBadge, SeverityBadge, StatusBadge, StormBadge } from '../badges';
import { Icon } from '../Icon';
import { useToast } from '../Toast';
import { RelTime } from '../ui';
import { MergeDialog, ResolveDialog, SilenceDialog } from './dialogs';

type Dialog = 'resolve' | 'merge' | 'silence' | null;

export function DetailHeader({ data, onIncident }: { data: IncidentDetail; onIncident: (incident: Incident) => void }) {
  const { incident } = data;
  const { canWrite, me } = useSession();
  const toast = useToast();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const rootAlert = data.alerts.find((a) => a.id === incident.rootAlertId);

  const simple = async (action: 'ack' | 'reopen') => {
    setBusy(action);
    try {
      const res = await api.post<{ incident: Incident }>(`/incidents/${encodeURIComponent(incident.id)}/${action}`, {
        actor: me.name,
      });
      onIncident(res.incident);
      toast.success(
        action === 'ack' ? `#${incident.number} bestätigt – Eskalation gestoppt.` : `#${incident.number} wieder geöffnet.`,
      );
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setBusy(null);
    }
  };

  const disabledTitle = canWrite ? undefined : NO_WRITE_TITLE;

  return (
    <div className="detail-header">
      <div className="row">
        <SeverityBadge severity={incident.severity} />
        <PriorityBadge priority={incident.priority} />
        <StatusBadge status={incident.status} />
        {incident.storm ? <StormBadge /> : null}
        {incident.recurrenceCount > 0 ? <RecurrenceBadge count={incident.recurrenceCount} /> : null}
      </div>
      <div className="detail-title">
        <h1>
          <span className="number">#{incident.number}</span> {incident.title}
        </h1>
      </div>
      <div className="detail-meta">
        <span>
          Erstellt <RelTime ts={incident.createdAt} />
        </span>
        {incident.acknowledgedAt ? (
          <>
            <span className="sep" />
            <span>
              Bestätigt <RelTime ts={incident.acknowledgedAt} />
              {incident.acknowledgedBy ? ` von ${incident.acknowledgedBy}` : ''}
            </span>
          </>
        ) : null}
        {incident.resolvedAt ? (
          <>
            <span className="sep" />
            <span>
              Gelöst <RelTime ts={incident.resolvedAt} />
              {incident.resolvedBy ? ` von ${incident.resolvedBy}` : ''}
            </span>
          </>
        ) : null}
        <span className="sep" />
        <span>
          {plural(incident.alertCount, 'Alarm', 'Alarme')} ({num(incident.firingCount)} aktiv) ·{' '}
          {plural(incident.eventCount, 'Ereignis', 'Ereignisse')}
        </span>
      </div>
      <div className="detail-actions">
        {incident.status === 'open' ? (
          <button
            type="button"
            className="btn btn-primary"
            disabled={!canWrite || busy !== null}
            title={disabledTitle}
            onClick={() => void simple('ack')}
          >
            <Icon name="check" size={15} /> {busy === 'ack' ? 'Bestätige…' : 'Bestätigen'}
          </button>
        ) : null}
        {incident.status !== 'resolved' ? (
          <button
            type="button"
            className="btn btn-ok"
            disabled={!canWrite}
            title={disabledTitle}
            onClick={() => setDialog('resolve')}
          >
            <Icon name="checkCircle" size={15} /> Auflösen
          </button>
        ) : (
          <button
            type="button"
            className="btn"
            disabled={!canWrite || busy !== null}
            title={disabledTitle}
            onClick={() => void simple('reopen')}
          >
            <Icon name="repeat" size={15} /> {busy === 'reopen' ? 'Öffne…' : 'Wieder öffnen'}
          </button>
        )}
        <button type="button" className="btn" disabled={!canWrite} title={disabledTitle} onClick={() => setDialog('merge')}>
          <Icon name="merge" size={15} /> Zusammenführen
        </button>
        <button type="button" className="btn" disabled={!canWrite} title={disabledTitle} onClick={() => setDialog('silence')}>
          <Icon name="silence" size={15} /> Stummschalten
        </button>
      </div>

      {dialog === 'resolve' ? (
        <ResolveDialog
          incident={incident}
          onClose={() => setDialog(null)}
          onDone={(inc) => {
            setDialog(null);
            onIncident(inc);
            toast.success(`#${incident.number} gelöst.`);
          }}
        />
      ) : null}
      {dialog === 'merge' ? (
        <MergeDialog
          incident={incident}
          onClose={() => setDialog(null)}
          onDone={(target) => {
            setDialog(null);
            toast.success(`#${incident.number} wurde in #${target.number} zusammengeführt.`);
            navigate(`/incidents/${encodeURIComponent(target.id)}`);
          }}
        />
      ) : null}
      {dialog === 'silence' ? (
        <SilenceDialog
          incident={incident}
          rootAlert={rootAlert}
          onClose={() => setDialog(null)}
          onDone={() => {
            setDialog(null);
            toast.success('Stummschaltung erstellt.');
          }}
        />
      ) : null}
    </div>
  );
}
