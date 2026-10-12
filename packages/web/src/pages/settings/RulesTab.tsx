import { useEffect, useState } from 'react';
import type { EngineSettings, EventRule, Severity, VolumeRule } from '@openrelay/types';
import { api } from '../../lib/api';
import { formatLabels, parseLabels } from '../../lib/format';
import { useAction, useApi } from '../../lib/hooks';
import { SEVERITY_LABEL } from '../../lib/labels';
import { NO_WRITE_TITLE, useSession } from '../../lib/session';
import { Checkbox, cleanMatchers, Field, MatcherListEditor, NumberField, SeveritySelect, TextField } from '../../components/form';
import { Icon } from '../../components/Icon';
import { useToast } from '../../components/Toast';
import { Card, ErrorBox, FormError, Hint, Loading } from '../../components/ui';

interface EventRuleDraft {
  key: number;
  name: string;
  matchers: string[];
  drop: boolean;
  severity: Severity | '';
  service: string;
  host: string;
  correlationKey: string;
  labels: string;
}

interface VolumeRuleDraft extends VolumeRule {
  key: number;
}

let keySeq = 1;

function toEventDraft(r: EventRule): EventRuleDraft {
  return {
    key: keySeq++,
    name: r.name,
    matchers: [...(r.matchers ?? [])],
    drop: !!r.drop,
    severity: r.set?.severity ?? '',
    service: r.set?.service ?? '',
    host: r.set?.host ?? '',
    correlationKey: r.set?.correlationKey ?? '',
    labels: formatLabels(r.set?.labels),
  };
}

function fromEventDraft(d: EventRuleDraft): EventRule {
  const rule: EventRule = { name: d.name.trim(), matchers: cleanMatchers(d.matchers) };
  if (d.drop) {
    rule.drop = true;
    return rule;
  }
  const set: NonNullable<EventRule['set']> = {};
  if (d.severity) set.severity = d.severity;
  if (d.service.trim()) set.service = d.service.trim();
  if (d.host.trim()) set.host = d.host.trim();
  if (d.correlationKey.trim()) set.correlationKey = d.correlationKey.trim();
  const labels = parseLabels(d.labels);
  if (Object.keys(labels).length) set.labels = labels;
  if (Object.keys(set).length) rule.set = set;
  return rule;
}

function move<T>(list: T[], index: number, delta: number): T[] {
  const target = index + delta;
  if (target < 0 || target >= list.length) return list;
  const next = list.slice();
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

function RuleControls({
  index,
  count,
  onMove,
  onRemove,
  label,
}: {
  index: number;
  count: number;
  onMove: (delta: number) => void;
  onRemove: () => void;
  label: string;
}) {
  return (
    <div className="row" style={{ gap: 2, flexWrap: 'nowrap' }}>
      <button
        type="button"
        className="btn btn-ghost btn-xs btn-icon"
        disabled={index === 0}
        onClick={() => onMove(-1)}
        aria-label={`${label} nach oben`}
        title="Nach oben"
      >
        <Icon name="up" size={14} />
      </button>
      <button
        type="button"
        className="btn btn-ghost btn-xs btn-icon"
        disabled={index === count - 1}
        onClick={() => onMove(1)}
        aria-label={`${label} nach unten`}
        title="Nach unten"
      >
        <Icon name="down" size={14} />
      </button>
      <button
        type="button"
        className="btn btn-ghost btn-xs btn-icon"
        onClick={() => {
          if (window.confirm(`${label} entfernen?`)) onRemove();
        }}
        aria-label={`${label} entfernen`}
        title="Entfernen"
      >
        <Icon name="trash" size={14} />
      </button>
    </div>
  );
}

export function RulesTab() {
  const { canWrite } = useSession();
  const toast = useToast();
  const remote = useApi<{ settings: EngineSettings }>('/settings');
  const [eventRules, setEventRules] = useState<EventRuleDraft[] | null>(null);
  const [volumeRules, setVolumeRules] = useState<VolumeRuleDraft[] | null>(null);
  const action = useAction();

  const reset = (s: EngineSettings) => {
    setEventRules((s.eventRules ?? []).map(toEventDraft));
    setVolumeRules((s.volumeRules ?? []).map((r) => ({ ...r, matchers: [...(r.matchers ?? [])], key: keySeq++ })));
  };

  useEffect(() => {
    if (remote.data && eventRules === null) reset(remote.data.settings);
  }, [remote.data, eventRules]);

  if (!eventRules || !volumeRules || !remote.data) {
    return remote.error ? <ErrorBox error={remote.error} onRetry={() => void remote.reload()} /> : <Loading />;
  }

  const outEvent = eventRules.map(fromEventDraft);
  const outVolume: VolumeRule[] = volumeRules.map((r) => ({
    name: r.name.trim(),
    matchers: cleanMatchers(r.matchers),
    count: r.count,
    windowMinutes: r.windowMinutes,
    raiseTo: r.raiseTo,
  }));
  const original = remote.data.settings;
  const dirty =
    JSON.stringify(outEvent) !== JSON.stringify((original.eventRules ?? []).map((r) => fromEventDraft(toEventDraft(r)))) ||
    JSON.stringify(outVolume) !==
      JSON.stringify(
        (original.volumeRules ?? []).map((r) => ({
          name: r.name,
          matchers: r.matchers ?? [],
          count: r.count,
          windowMinutes: r.windowMinutes,
          raiseTo: r.raiseTo,
        })),
      );

  const updateEvent = (key: number, patch: Partial<EventRuleDraft>) =>
    setEventRules((rs) => (rs ?? []).map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const updateVolume = (key: number, patch: Partial<VolumeRuleDraft>) =>
    setVolumeRules((rs) => (rs ?? []).map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const save = async () => {
    const unnamed = [...outEvent, ...outVolume].some((r) => !r.name);
    if (unnamed) {
      action.setError('Jede Regel braucht einen Namen.');
      return;
    }
    const res = await action.run(() =>
      api.put<{ settings: EngineSettings }>('/settings', { settings: { eventRules: outEvent, volumeRules: outVolume } }),
    );
    if (res.ok) {
      toast.success('Regeln gespeichert.');
      if (res.value?.settings) {
        remote.setData({ settings: res.value.settings });
        reset(res.value.settings);
      } else void remote.reload();
    }
  };

  return (
    <form
      className="settings-sections"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <fieldset disabled={!canWrite} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }} className="settings-sections">
        <Card
          title={
            <>
              Ereignisregeln <span className="muted">· {eventRules.length}</span>
            </>
          }
          actions={
            <button
              type="button"
              className="btn btn-sm"
              onClick={() =>
                setEventRules((rs) => [
                  ...(rs ?? []),
                  {
                    key: keySeq++,
                    name: '',
                    matchers: [''],
                    drop: false,
                    severity: '',
                    service: '',
                    host: '',
                    correlationKey: '',
                    labels: '',
                  },
                ])
              }
            >
              <Icon name="plus" size={14} /> Ereignisregel
            </button>
          }
        >
          <div className="stack">
            <Hint>
              Ereignisregeln werden beim Eingang jedes Ereignisses der Reihe nach angewendet: Sie können Ereignisse verwerfen (z.
              B. Debug-Rauschen) oder Felder setzen (z. B. Schweregrad anheben, Service zuordnen).
            </Hint>
            {eventRules.length === 0 ? <p className="muted small">Keine Ereignisregeln definiert.</p> : null}
            {eventRules.map((r, i) => (
              <div className="rule-card" key={r.key}>
                <div className="rule-head">
                  <input
                    className="input"
                    value={r.name}
                    placeholder="Name der Regel"
                    aria-label="Name der Regel"
                    onChange={(e) => updateEvent(r.key, { name: e.target.value })}
                  />
                  <RuleControls
                    index={i}
                    count={eventRules.length}
                    label={`Ereignisregel „${r.name || i + 1}“`}
                    onMove={(d) => setEventRules((rs) => move(rs ?? [], i, d))}
                    onRemove={() => setEventRules((rs) => (rs ?? []).filter((x) => x.key !== r.key))}
                  />
                </div>
                <MatcherListEditor value={r.matchers} onChange={(v) => updateEvent(r.key, { matchers: v })} />
                <Checkbox
                  checked={r.drop}
                  onChange={(v) => updateEvent(r.key, { drop: v })}
                  label="Passende Ereignisse verwerfen"
                  hint="Verworfene Ereignisse erscheinen unter „Ereignisse“ mit der Aktion „verworfen“."
                />
                {!r.drop ? (
                  <div className="stack-sm">
                    <span className="field-label">Felder setzen</span>
                    <div className="form-grid">
                      <Field label="Schweregrad">
                        <SeveritySelect
                          value={r.severity}
                          onChange={(v) => updateEvent(r.key, { severity: v })}
                          allowEmpty
                          emptyLabel="unverändert"
                          ariaLabel="Schweregrad setzen"
                        />
                      </Field>
                      <TextField
                        label="Service"
                        value={r.service}
                        onChange={(v) => updateEvent(r.key, { service: v })}
                        placeholder="unverändert"
                      />
                      <TextField
                        label="Host"
                        value={r.host}
                        onChange={(v) => updateEvent(r.key, { host: v })}
                        placeholder="unverändert"
                      />
                      <TextField
                        label="Korrelationsschlüssel"
                        value={r.correlationKey}
                        onChange={(v) => updateEvent(r.key, { correlationKey: v })}
                        placeholder="unverändert"
                      />
                    </div>
                    <Field label="Labels setzen" hint="Eine Zeile pro Label: schlüssel=wert">
                      <textarea
                        className="input mono"
                        rows={2}
                        value={r.labels}
                        onChange={(e) => updateEvent(r.key, { labels: e.target.value })}
                        aria-label="Labels setzen"
                        spellCheck={false}
                      />
                    </Field>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </Card>

        <Card
          title={
            <>
              Volumenregeln <span className="muted">· {volumeRules.length}</span>
            </>
          }
          actions={
            <button
              type="button"
              className="btn btn-sm"
              onClick={() =>
                setVolumeRules((rs) => [
                  ...(rs ?? []),
                  { key: keySeq++, name: '', matchers: [], count: 50, windowMinutes: 10, raiseTo: 'high' },
                ])
              }
            >
              <Icon name="plus" size={14} /> Volumenregel
            </button>
          }
        >
          <div className="stack">
            <Hint>
              Volumenregeln heben den Schweregrad eines Alarms an, wenn er in kurzer Zeit sehr oft auftritt – z. B. 50 Warnungen
              in 10 Minuten werden zu „Hoch“.
            </Hint>
            {volumeRules.length === 0 ? <p className="muted small">Keine Volumenregeln definiert.</p> : null}
            {volumeRules.map((r, i) => (
              <div className="rule-card" key={r.key}>
                <div className="rule-head">
                  <input
                    className="input"
                    value={r.name}
                    placeholder="Name der Regel"
                    aria-label="Name der Regel"
                    onChange={(e) => updateVolume(r.key, { name: e.target.value })}
                  />
                  <RuleControls
                    index={i}
                    count={volumeRules.length}
                    label={`Volumenregel „${r.name || i + 1}“`}
                    onMove={(d) => setVolumeRules((rs) => move(rs ?? [], i, d))}
                    onRemove={() => setVolumeRules((rs) => (rs ?? []).filter((x) => x.key !== r.key))}
                  />
                </div>
                <MatcherListEditor value={r.matchers} onChange={(v) => updateVolume(r.key, { matchers: v })} />
                <div className="form-grid">
                  <NumberField
                    label="Anzahl Ereignisse"
                    min={1}
                    value={r.count}
                    onChange={(v) => updateVolume(r.key, { count: v ?? 1 })}
                  />
                  <NumberField
                    label="innerhalb von"
                    unit="min"
                    min={1}
                    value={r.windowMinutes}
                    onChange={(v) => updateVolume(r.key, { windowMinutes: v ?? 1 })}
                  />
                  <Field label="anheben auf">
                    <SeveritySelect
                      value={r.raiseTo}
                      onChange={(v) => updateVolume(r.key, { raiseTo: (v || 'high') as Severity })}
                      ariaLabel="anheben auf"
                    />
                  </Field>
                </div>
                <span className="small muted">
                  {r.count} Ereignisse eines Alarms in {r.windowMinutes} min → {SEVERITY_LABEL[r.raiseTo]}
                </span>
              </div>
            ))}
          </div>
        </Card>
      </fieldset>

      <div className="sticky-save">
        {!canWrite ? <span className="muted small">{NO_WRITE_TITLE}</span> : null}
        <FormError error={action.error} />
        {dirty ? <span className="muted small">Ungespeicherte Änderungen</span> : null}
        <button type="button" className="btn" disabled={!dirty || action.busy} onClick={() => reset(original)}>
          Verwerfen
        </button>
        <button type="submit" className="btn btn-primary" disabled={!canWrite || !dirty || action.busy}>
          {action.busy ? 'Speichere…' : 'Speichern'}
        </button>
      </div>
    </form>
  );
}
