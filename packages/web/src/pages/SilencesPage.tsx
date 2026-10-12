import { useMemo, useState } from 'react';
import type { Silence } from '@openrelay/types';
import { api, errorText } from '../lib/api';
import type { ListResponse } from '../lib/apiTypes';
import { absTime, durationMs, fromLocalInput, toLocalInput } from '../lib/format';
import { useAction, useApi, useNow } from '../lib/hooks';
import { NO_WRITE_TITLE, useSession } from '../lib/session';
import { Badge } from '../components/badges';
import { cleanMatchers, Field, MatcherListEditor, TextField } from '../components/form';
import { Icon } from '../components/Icon';
import { Modal } from '../components/Modal';
import { useToast } from '../components/Toast';
import { AsyncBlock, Card, EmptyState, FormError, PageHeader, RelTime, Tabs } from '../components/ui';

const PRESETS = [
  { label: '30 min', ms: 30 * 60_000 },
  { label: '1 h', ms: 3_600_000 },
  { label: '2 h', ms: 2 * 3_600_000 },
  { label: '4 h', ms: 4 * 3_600_000 },
  { label: '8 h', ms: 8 * 3_600_000 },
  { label: '24 h', ms: 24 * 3_600_000 },
  { label: '7 Tage', ms: 7 * 24 * 3_600_000 },
];

interface Draft {
  matchers: string[];
  comment: string;
}

function SilenceEditor({ draft, onClose, onSaved }: { draft: Draft; onClose: () => void; onSaved: () => void }) {
  const [matchers, setMatchers] = useState<string[]>(draft.matchers.length ? draft.matchers : ['']);
  const [comment, setComment] = useState(draft.comment);
  const [startMode, setStartMode] = useState<'now' | 'at'>('now');
  const [startAt, setStartAt] = useState(() => toLocalInput(Date.now() + 3_600_000));
  const [endMode, setEndMode] = useState<'preset' | 'at'>('preset');
  const [preset, setPreset] = useState(PRESETS[1].ms);
  const [endAt, setEndAt] = useState(() => toLocalInput(Date.now() + 4 * 3_600_000));
  const action = useAction();

  const computeRange = (): { startsAt: number; endsAt: number } | string => {
    const now = Date.now();
    const startsAt = startMode === 'now' ? now : fromLocalInput(startAt);
    if (startsAt === null) return 'Bitte einen gültigen Beginn angeben.';
    const endsAt = endMode === 'preset' ? startsAt + preset : fromLocalInput(endAt);
    if (endsAt === null) return 'Bitte ein gültiges Ende angeben.';
    if (endsAt <= startsAt) return 'Das Ende muss nach dem Beginn liegen.';
    if (endsAt <= now) return 'Das Ende liegt in der Vergangenheit.';
    return { startsAt, endsAt };
  };

  const range = computeRange();

  const save = async () => {
    const list = cleanMatchers(matchers);
    if (list.length === 0) {
      action.setError('Mindestens eine Bedingung ist nötig – sonst würde alles stummgeschaltet.');
      return;
    }
    const r = computeRange();
    if (typeof r === 'string') {
      action.setError(r);
      return;
    }
    const res = await action.run(() =>
      api.post<{ silence: Silence }>('/silences', { matchers: list, ...r, comment: comment.trim() || null }),
    );
    if (res.ok) onSaved();
  };

  return (
    <Modal
      title="Neue Stummschaltung"
      onClose={onClose}
      onSubmit={() => void save()}
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
      <MatcherListEditor
        value={matchers}
        onChange={setMatchers}
        emptyHint="Mindestens eine Bedingung angeben."
        placeholder="z. B. service = api"
      />
      <Field label="Beginn">
        <div className="row">
          <div className="segmented" role="group" aria-label="Beginn">
            <button type="button" aria-pressed={startMode === 'now'} onClick={() => setStartMode('now')}>
              Sofort
            </button>
            <button type="button" aria-pressed={startMode === 'at'} onClick={() => setStartMode('at')}>
              Zeitpunkt
            </button>
          </div>
          {startMode === 'at' ? (
            <input
              className="input"
              type="datetime-local"
              value={startAt}
              onChange={(e) => setStartAt(e.target.value)}
              aria-label="Beginn"
              style={{ width: 'auto' }}
            />
          ) : null}
        </div>
      </Field>
      <Field label="Dauer">
        <div className="stack-sm">
          <div className="presets" role="group" aria-label="Dauer">
            {PRESETS.map((p) => (
              <button
                key={p.ms}
                type="button"
                aria-pressed={endMode === 'preset' && preset === p.ms}
                onClick={() => {
                  setEndMode('preset');
                  setPreset(p.ms);
                }}
              >
                {p.label}
              </button>
            ))}
            <button type="button" aria-pressed={endMode === 'at'} onClick={() => setEndMode('at')}>
              Ende festlegen
            </button>
          </div>
          {endMode === 'at' ? (
            <input
              className="input"
              type="datetime-local"
              value={endAt}
              onChange={(e) => setEndAt(e.target.value)}
              aria-label="Ende"
              style={{ width: 'auto' }}
            />
          ) : null}
          <span className="small muted">
            {typeof range === 'string'
              ? range
              : `${absTime(range.startsAt)} – ${absTime(range.endsAt)} (${durationMs(range.endsAt - range.startsAt)})`}
          </span>
        </div>
      </Field>
      <TextField label="Kommentar" value={comment} onChange={setComment} placeholder="z. B. Wartungsfenster Datenbank" />
      <FormError error={action.error} />
    </Modal>
  );
}

type Tab = 'active' | 'expired';

export function SilencesPage() {
  const { canWrite } = useSession();
  const toast = useToast();
  const now = useNow();
  const list = useApi<ListResponse<Silence>>('/silences');
  const [tab, setTab] = useState<Tab>('active');
  const [draft, setDraft] = useState<Draft | null>(null);

  const { active, expired } = useMemo(() => {
    const t = Math.max(now, Date.now());
    const items = list.data?.items ?? [];
    return {
      active: items.filter((s) => s.endsAt > t).sort((a, b) => a.endsAt - b.endsAt),
      expired: items.filter((s) => s.endsAt <= t).sort((a, b) => b.endsAt - a.endsAt),
    };
  }, [list.data, now]);

  const endNow = async (s: Silence) => {
    if (!window.confirm('Stummschaltung jetzt beenden?')) return;
    const t = Date.now();
    try {
      await api.put<{ silence: Silence }>(`/silences/${encodeURIComponent(s.id)}`, {
        matchers: s.matchers,
        startsAt: Math.min(s.startsAt, t),
        endsAt: t,
        comment: s.comment,
      });
      toast.success('Stummschaltung beendet.');
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      void list.reload();
    }
  };

  const remove = async (s: Silence) => {
    if (!window.confirm('Stummschaltung endgültig löschen?')) return;
    try {
      await api.del(`/silences/${encodeURIComponent(s.id)}`);
      toast.success('Stummschaltung gelöscht.');
      void list.reload();
    } catch (err) {
      toast.error(errorText(err));
    }
  };

  const shown = tab === 'active' ? active : expired;

  return (
    <div className="page">
      <PageHeader
        title="Stummschaltungen"
        subtitle="Unterdrücken Benachrichtigungen für passende Ereignisse, z. B. während Wartungsfenstern. Vorfälle werden weiterhin erfasst."
        actions={
          <button
            type="button"
            className="btn btn-primary"
            disabled={!canWrite}
            title={canWrite ? undefined : NO_WRITE_TITLE}
            onClick={() => setDraft({ matchers: [''], comment: '' })}
          >
            <Icon name="plus" size={15} /> Neue Stummschaltung
          </button>
        }
      />
      <Tabs
        label="Stummschaltungen"
        value={tab}
        onChange={setTab}
        items={[
          { key: 'active', label: 'Aktiv & geplant', count: list.data ? active.length : undefined },
          { key: 'expired', label: 'Abgelaufen', count: list.data ? expired.length : undefined },
        ]}
      />
      <Card flush>
        <AsyncBlock
          data={list.data}
          error={list.error}
          loading={list.loading}
          onRetry={() => void list.reload()}
          isEmpty={() => shown.length === 0}
          empty={
            <EmptyState
              title={tab === 'active' ? 'Keine aktiven Stummschaltungen' : 'Keine abgelaufenen Stummschaltungen'}
              icon="silence"
            >
              {tab === 'active' ? 'Alle Benachrichtigungen werden normal zugestellt.' : null}
            </EmptyState>
          }
        >
          {() => (
            <div className="list">
              {shown.map((s) => {
                const t = Date.now();
                const scheduled = s.startsAt > t;
                const isActive = !scheduled && s.endsAt > t;
                return (
                  <div key={s.id} className="list-item">
                    <div className="list-main">
                      <div className="list-title">
                        {isActive ? (
                          <Badge tone="warning" dot>
                            aktiv
                          </Badge>
                        ) : scheduled ? (
                          <Badge tone="info" dot>
                            geplant
                          </Badge>
                        ) : (
                          <Badge dot>abgelaufen</Badge>
                        )}
                        <span className="matchers">
                          {s.matchers.map((m, i) => (
                            <code key={i} className="matcher" title={m}>
                              {m}
                            </code>
                          ))}
                        </span>
                      </div>
                      {s.comment ? <div>{s.comment}</div> : null}
                      <div className="list-meta">
                        {scheduled ? (
                          <span>
                            beginnt <RelTime ts={s.startsAt} />
                          </span>
                        ) : (
                          <span title={absTime(s.startsAt)}>seit {absTime(s.startsAt)}</span>
                        )}
                        <span>
                          {s.endsAt > t ? 'endet' : 'endete'} <RelTime ts={s.endsAt} />
                        </span>
                        <span>Dauer {durationMs(s.endsAt - s.startsAt)}</span>
                        {s.createdBy ? <span>von {s.createdBy}</span> : null}
                      </div>
                    </div>
                    <div className="list-side">
                      {s.endsAt > t ? (
                        <button type="button" className="btn btn-sm" disabled={!canWrite} onClick={() => void endNow(s)}>
                          <Icon name="x" size={13} /> Jetzt beenden
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="btn btn-sm"
                          disabled={!canWrite}
                          onClick={() => setDraft({ matchers: [...s.matchers], comment: s.comment ?? '' })}
                        >
                          <Icon name="repeat" size={13} /> Erneut anlegen
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn btn-sm btn-icon btn-danger"
                        disabled={!canWrite}
                        onClick={() => void remove(s)}
                        aria-label="Stummschaltung löschen"
                        title="Löschen"
                      >
                        <Icon name="trash" size={14} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </AsyncBlock>
      </Card>
      {draft ? (
        <SilenceEditor
          draft={draft}
          onClose={() => setDraft(null)}
          onSaved={() => {
            setDraft(null);
            toast.success('Stummschaltung erstellt.');
            setTab('active');
            void list.reload();
          }}
        />
      ) : null}
    </div>
  );
}
