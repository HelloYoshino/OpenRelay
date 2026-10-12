import { useMemo, useState } from 'react';
import type { TimelineEntry, TimelineKind } from '@openrelay/types';
import { api } from '../../lib/api';
import { useAction } from '../../lib/hooks';
import { TIMELINE_LABEL, labelOf } from '../../lib/labels';
import { NO_WRITE_TITLE, useSession } from '../../lib/session';
import type { Tone } from '../badges';
import { Icon, type IconName } from '../Icon';
import { FormError, RelTime } from '../ui';

const KIND_STYLE: Record<TimelineKind, { icon: IconName; tone: Tone }> = {
  created: { icon: 'plus', tone: 'accent' },
  alert_added: { icon: 'layers', tone: 'info' },
  alert_resolved: { icon: 'checkCircle', tone: 'ok' },
  alert_reopened: { icon: 'repeat', tone: 'high' },
  alert_detached: { icon: 'detach', tone: 'neutral' },
  severity_changed: { icon: 'up', tone: 'warning' },
  flapping: { icon: 'wave', tone: 'warning' },
  notified: { icon: 'send', tone: 'accent' },
  digest_queued: { icon: 'clock', tone: 'neutral' },
  suppressed: { icon: 'silence', tone: 'debug' },
  unrouted: { icon: 'routing', tone: 'warning' },
  escalated: { icon: 'escalation', tone: 'high' },
  acknowledged: { icon: 'check', tone: 'warning' },
  resolved: { icon: 'checkCircle', tone: 'ok' },
  reopened: { icon: 'repeat', tone: 'critical' },
  merged: { icon: 'merge', tone: 'accent' },
  linked: { icon: 'link', tone: 'info' },
  comment: { icon: 'comment', tone: 'neutral' },
};

function reasonsOf(entry: TimelineEntry): string[] {
  const reasons = entry.data?.reasons;
  return Array.isArray(reasons) ? reasons.filter((r): r is string => typeof r === 'string' && r.length > 0) : [];
}

function scoreOf(entry: TimelineEntry): number | null {
  const score = entry.data?.score;
  return typeof score === 'number' && Number.isFinite(score) ? score : null;
}

export function ScoreBar({ score }: { score: number }) {
  const pct = Math.round(Math.min(1, Math.max(0, score)) * 100);
  return (
    <span className="score-pill" title={`Korrelations-Score ${score.toFixed(2)}`}>
      <span className="score-bar" aria-hidden>
        <span style={{ width: `${pct}%` }} />
      </span>
      {Math.round(score * 100)} %
    </span>
  );
}

function TimelineItem({ entry }: { entry: TimelineEntry }) {
  const style = KIND_STYLE[entry.kind] ?? { icon: 'info' as IconName, tone: 'neutral' as Tone };
  const reasons = entry.kind === 'alert_added' ? reasonsOf(entry) : [];
  const score = entry.kind === 'alert_added' ? scoreOf(entry) : null;
  return (
    <li className="tl-item">
      <span className={`tl-icon tone-${style.tone}`} aria-hidden>
        <Icon name={style.icon} size={14} />
      </span>
      <div className="tl-body">
        <div className="tl-head">
          <span className="tl-kind">{labelOf(TIMELINE_LABEL, entry.kind)}</span>
          <span className="tl-meta">
            {entry.actor ? `${entry.actor} · ` : ''}
            <RelTime ts={entry.ts} />
          </span>
        </div>
        {entry.message ? (
          <div className={`tl-message${entry.kind === 'comment' ? ' tl-comment' : ''}`}>{entry.message}</div>
        ) : null}
        {score !== null || reasons.length ? (
          <div className="stack-sm" style={{ gap: 4 }}>
            {score !== null ? (
              <span className="tl-meta row" style={{ gap: 6 }}>
                Zugeordnet mit <ScoreBar score={score} />
              </span>
            ) : null}
            {reasons.length ? (
              <ul className="tl-reasons" aria-label="Gründe der Zuordnung">
                {reasons.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>
    </li>
  );
}

export function Timeline({
  incidentId,
  entries,
  onCommented,
}: {
  incidentId: string;
  entries: TimelineEntry[];
  onCommented: (entry: TimelineEntry | undefined) => void;
}) {
  const { canWrite, me } = useSession();
  const [text, setText] = useState('');
  const action = useAction();
  const [showAll, setShowAll] = useState(false);

  const sorted = useMemo(() => [...entries].sort((a, b) => b.ts - a.ts || b.id - a.id), [entries]);
  const visible = showAll ? sorted : sorted.slice(0, 60);

  const submit = async () => {
    const value = text.trim();
    if (!value) return;
    const res = await action.run(() =>
      api.post<{ entry: TimelineEntry }>(`/incidents/${encodeURIComponent(incidentId)}/comment`, { text: value, actor: me.name }),
    );
    if (res.ok) {
      setText('');
      onCommented(res.value?.entry);
    }
  };

  return (
    <div className="stack">
      <form
        className="comment-form"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <textarea
          className="input"
          placeholder={canWrite ? 'Kommentar hinzufügen…' : NO_WRITE_TITLE}
          aria-label="Kommentar"
          value={text}
          disabled={!canWrite}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void submit();
            }
          }}
        />
        <FormError error={action.error} />
        <div className="row-between">
          <span className="muted small">Strg/⌘ + Enter zum Senden</span>
          <button type="submit" className="btn btn-sm btn-primary" disabled={!canWrite || action.busy || !text.trim()}>
            <Icon name="comment" size={14} /> {action.busy ? 'Sende…' : 'Kommentieren'}
          </button>
        </div>
      </form>
      {sorted.length === 0 ? (
        <div className="muted small">Noch keine Einträge.</div>
      ) : (
        <ol className="timeline">
          {visible.map((entry) => (
            <TimelineItem key={entry.id} entry={entry} />
          ))}
        </ol>
      )}
      {!showAll && sorted.length > visible.length ? (
        <button type="button" className="btn btn-sm" onClick={() => setShowAll(true)}>
          Alle {sorted.length} Einträge anzeigen
        </button>
      ) : null}
    </div>
  );
}
