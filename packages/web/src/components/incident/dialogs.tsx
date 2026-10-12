import { useMemo, useState } from 'react';
import type { Alert, Incident, Silence } from '@openrelay/types';
import { api } from '../../lib/api';
import type { PagedResponse } from '../../lib/apiTypes';
import { absTime } from '../../lib/format';
import { useAction, useApi } from '../../lib/hooks';
import { useSession } from '../../lib/session';
import { cleanMatchers, MatcherListEditor } from '../form';
import { SeverityBadge, StatusBadge } from '../badges';
import { Modal } from '../Modal';
import { EmptyState, ErrorBox, FormError, Loading } from '../ui';
import { Icon } from '../Icon';

export function ResolveDialog({
  incident,
  onClose,
  onDone,
}: {
  incident: Incident;
  onClose: () => void;
  onDone: (incident: Incident) => void;
}) {
  const { me } = useSession();
  const [note, setNote] = useState('');
  const action = useAction();
  return (
    <Modal
      title={`#${incident.number} auflösen`}
      onClose={onClose}
      size="sm"
      onSubmit={async () => {
        const res = await action.run(() =>
          api.post<{ incident: Incident }>(`/incidents/${encodeURIComponent(incident.id)}/resolve`, {
            actor: me.name,
            note: note.trim() || undefined,
          }),
        );
        if (res.ok) onDone(res.value.incident);
      }}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Abbrechen
          </button>
          <button type="submit" className="btn btn-primary" disabled={action.busy}>
            <Icon name="checkCircle" size={14} /> {action.busy ? 'Löse auf…' : 'Auflösen'}
          </button>
        </>
      }
    >
      <p className="muted">Der Vorfall wird als gelöst markiert, laufende Eskalationen werden beendet.</p>
      <div className="field">
        <label className="field-label" htmlFor="resolve-note">
          Notiz (optional)
        </label>
        <textarea
          id="resolve-note"
          className="input"
          placeholder="z. B. Ursache und Lösung"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          autoFocus
        />
      </div>
      <FormError error={action.error} />
    </Modal>
  );
}

export function MergeDialog({
  incident,
  onClose,
  onDone,
}: {
  incident: Incident;
  onClose: () => void;
  onDone: (target: Incident) => void;
}) {
  const { me } = useSession();
  const open = useApi<PagedResponse<Incident>>('/incidents', { status: 'open,acknowledged', limit: 200 });
  const [filter, setFilter] = useState('');
  const [targetId, setTargetId] = useState<string | null>(null);
  const action = useAction();

  const candidates = useMemo(() => {
    const items = (open.data?.items ?? []).filter((i) => i.id !== incident.id);
    const f = filter.trim().replace(/^#/, '').toLowerCase();
    if (!f) return items;
    return items.filter((i) => String(i.number).startsWith(f) || i.title.toLowerCase().includes(f));
  }, [open.data, filter, incident.id]);

  const exact = candidates.find((c) => String(c.number) === filter.trim().replace(/^#/, ''));
  const selected = targetId ?? exact?.id ?? null;

  return (
    <Modal
      title={`#${incident.number} zusammenführen`}
      onClose={onClose}
      onSubmit={async () => {
        if (!selected) {
          action.setError('Bitte einen Zielvorfall auswählen.');
          return;
        }
        const res = await action.run(() =>
          api.post<{ incident: Incident }>(`/incidents/${encodeURIComponent(incident.id)}/merge`, {
            targetId: selected,
            actor: me.name,
          }),
        );
        if (res.ok) onDone(res.value.incident);
      }}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Abbrechen
          </button>
          <button type="submit" className="btn btn-primary" disabled={action.busy || !selected}>
            <Icon name="merge" size={14} /> {action.busy ? 'Führe zusammen…' : 'Zusammenführen'}
          </button>
        </>
      }
    >
      <p className="muted">
        Alle Alarme von #{incident.number} wandern in den gewählten Vorfall. OpenRelay merkt sich diese Zuordnung und gruppiert
        ähnliche Alarme künftig automatisch.
      </p>
      <div className="field">
        <label className="field-label" htmlFor="merge-filter">
          Zielvorfall (Nummer oder Titel)
        </label>
        <input
          id="merge-filter"
          className="input"
          placeholder="z. B. 42"
          value={filter}
          autoFocus
          onChange={(e) => {
            setFilter(e.target.value);
            setTargetId(null);
          }}
        />
      </div>
      {open.data === undefined ? (
        open.error ? (
          <ErrorBox error={open.error} onRetry={() => void open.reload()} />
        ) : (
          <Loading />
        )
      ) : candidates.length === 0 ? (
        <EmptyState title="Keine passenden offenen Vorfälle" icon="search" />
      ) : (
        <div className="checkbox-list" role="radiogroup" aria-label="Zielvorfall" style={{ maxHeight: 280 }}>
          {candidates.map((c) => (
            <label key={c.id} className="check" style={{ alignItems: 'center' }}>
              <input type="radio" name="merge-target" checked={selected === c.id} onChange={() => setTargetId(c.id)} />
              <span className="row" style={{ gap: 8, flexWrap: 'nowrap', minWidth: 0 }}>
                <span className="muted num">#{c.number}</span>
                <SeverityBadge severity={c.severity} compact />
                <span className="truncate">{c.title}</span>
                <StatusBadge status={c.status} />
              </span>
            </label>
          ))}
        </div>
      )}
      <FormError error={action.error} />
    </Modal>
  );
}

const DURATIONS = [
  { label: '1 h', ms: 3_600_000 },
  { label: '4 h', ms: 4 * 3_600_000 },
  { label: '24 h', ms: 24 * 3_600_000 },
];

/** Matchers that target the incident's root alert (fallback: the incident itself). */
export function matchersFor(incident: Incident, root: Alert | undefined): string[] {
  const matchers: string[] = [];
  const service = root?.service ?? (incident.services.length === 1 ? incident.services[0] : null);
  if (service) matchers.push(`service = ${service}`);
  matchers.push(`title = ${root?.title ?? incident.title}`);
  return matchers;
}

export function SilenceDialog({
  incident,
  rootAlert,
  onClose,
  onDone,
}: {
  incident: Incident;
  rootAlert: Alert | undefined;
  onClose: () => void;
  onDone: (silence: Silence | undefined) => void;
}) {
  const [matchers, setMatchers] = useState<string[]>(() => matchersFor(incident, rootAlert));
  const [duration, setDuration] = useState(DURATIONS[0].ms);
  const [comment, setComment] = useState(`Stummgeschaltet aus Vorfall #${incident.number}`);
  const action = useAction();
  const endsAt = Date.now() + duration;

  return (
    <Modal
      title="Stummschalten"
      onClose={onClose}
      onSubmit={async () => {
        const list = cleanMatchers(matchers);
        if (list.length === 0) {
          action.setError('Mindestens eine Bedingung ist nötig – sonst würde alles stummgeschaltet.');
          return;
        }
        const now = Date.now();
        const res = await action.run(() =>
          api.post<{ silence: Silence }>('/silences', {
            matchers: list,
            startsAt: now,
            endsAt: now + duration,
            comment: comment.trim() || null,
          }),
        );
        if (res.ok) onDone(res.value?.silence);
      }}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Abbrechen
          </button>
          <button type="submit" className="btn btn-primary" disabled={action.busy}>
            <Icon name="silence" size={14} /> {action.busy ? 'Speichere…' : 'Stummschalten'}
          </button>
        </>
      }
    >
      <p className="muted">
        Passende neue Ereignisse lösen während der Stummschaltung keine Benachrichtigungen aus. Die Bedingungen sind aus dem
        vermuteten Ursachen-Alarm übernommen.
      </p>
      <MatcherListEditor value={matchers} onChange={setMatchers} emptyHint="Mindestens eine Bedingung angeben." />
      <div className="field">
        <span className="field-label">Dauer</span>
        <div className="row">
          <div className="segmented" role="group" aria-label="Dauer">
            {DURATIONS.map((d) => (
              <button key={d.ms} type="button" aria-pressed={duration === d.ms} onClick={() => setDuration(d.ms)}>
                {d.label}
              </button>
            ))}
          </div>
          <span className="muted small">bis {absTime(endsAt)}</span>
        </div>
      </div>
      <div className="field">
        <label className="field-label" htmlFor="silence-comment">
          Kommentar
        </label>
        <input id="silence-comment" className="input" value={comment} onChange={(e) => setComment(e.target.value)} />
      </div>
      <FormError error={action.error} />
    </Modal>
  );
}
