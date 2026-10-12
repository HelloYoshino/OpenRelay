import { useState } from 'react';
import type { EscalationPolicy, EscalationStep } from '@openrelay/types';
import { api, errorText } from '../lib/api';
import type { ListResponse } from '../lib/apiTypes';
import { channelCache, policyCache, useChannelMap } from '../lib/cache';
import { durationMinutes } from '../lib/format';
import { useAction, useApi } from '../lib/hooks';
import { NO_WRITE_TITLE, useSession } from '../lib/session';
import { Chip } from '../components/badges';
import { CheckboxList, NumberField, TextField } from '../components/form';
import { Icon } from '../components/Icon';
import { Modal } from '../components/Modal';
import { useToast } from '../components/Toast';
import { AsyncBlock, Card, EmptyState, FormError, Hint, PageHeader } from '../components/ui';

type PolicyInput = Pick<EscalationPolicy, 'name' | 'steps' | 'repeat'>;

function explainSteps(steps: EscalationStep[], repeat: number): string[] {
  const lines: string[] = [];
  let total = 0;
  steps.forEach((s, i) => {
    total += s.delayMinutes;
    const after = i === 0 ? 'der ersten Benachrichtigung' : `Stufe ${i}`;
    lines.push(
      `Stufe ${i + 1} wird ${durationMinutes(s.delayMinutes)} nach ${after} ausgelöst, falls niemand bestätigt` +
        (i > 0 ? ` (insgesamt ${durationMinutes(total)} nach der ersten Benachrichtigung).` : '.'),
    );
  });
  if (steps.length && repeat > 0) {
    lines.push(`Danach wird die gesamte Kette ${repeat}× wiederholt, solange der Vorfall unbestätigt bleibt.`);
  }
  return lines;
}

function PolicyEditor({
  policy,
  onClose,
  onSaved,
}: {
  policy: EscalationPolicy | null;
  onClose: () => void;
  onSaved: (p: EscalationPolicy) => void;
}) {
  const channels = channelCache.use();
  const [form, setForm] = useState<PolicyInput>(() =>
    policy
      ? { name: policy.name, steps: policy.steps.map((s) => ({ ...s, channels: [...s.channels] })), repeat: policy.repeat }
      : { name: '', steps: [{ delayMinutes: 15, channels: [] }], repeat: 0 },
  );
  const action = useAction();

  const updateStep = (index: number, patch: Partial<EscalationStep>) =>
    setForm((f) => ({ ...f, steps: f.steps.map((s, i) => (i === index ? { ...s, ...patch } : s)) }));
  const moveStep = (index: number, delta: number) =>
    setForm((f) => {
      const steps = f.steps.slice();
      const target = index + delta;
      if (target < 0 || target >= steps.length) return f;
      [steps[index], steps[target]] = [steps[target], steps[index]];
      return { ...f, steps };
    });

  const save = async () => {
    if (!form.name.trim()) {
      action.setError('Bitte einen Namen angeben.');
      return;
    }
    if (form.steps.length === 0) {
      action.setError('Mindestens eine Stufe ist nötig.');
      return;
    }
    const empty = form.steps.findIndex((s) => s.channels.length === 0);
    if (empty !== -1) {
      action.setError(`Stufe ${empty + 1} hat keinen Kanal.`);
      return;
    }
    const body: PolicyInput = {
      name: form.name.trim(),
      repeat: Math.max(0, Math.round(form.repeat)),
      steps: form.steps.map((s) => ({ delayMinutes: Math.max(0, Math.round(s.delayMinutes)), channels: s.channels })),
    };
    const res = await action.run(() =>
      policy
        ? api.put<{ policy: EscalationPolicy }>(`/escalation-policies/${encodeURIComponent(policy.id)}`, body)
        : api.post<{ policy: EscalationPolicy }>('/escalation-policies', body),
    );
    if (res.ok) onSaved(res.value.policy);
  };

  const channelOptions = (channels ?? []).map((c) => ({
    value: c.id,
    label: (
      <>
        {c.name} <span className="muted small">· {c.type}</span>
      </>
    ),
  }));

  return (
    <Modal
      title={policy ? `Richtlinie bearbeiten: ${policy.name}` : 'Neue Eskalationsrichtlinie'}
      onClose={onClose}
      size="lg"
      onSubmit={() => void save()}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Abbrechen
          </button>
          <button type="submit" className="btn btn-primary" disabled={action.busy}>
            {action.busy ? 'Speichere…' : 'Speichern'}
          </button>
        </>
      }
    >
      <div className="grid-2">
        <TextField
          label="Name"
          required
          value={form.name}
          onChange={(v) => setForm((f) => ({ ...f, name: v }))}
          placeholder="z. B. Bereitschaft Infrastruktur"
          autoFocus
        />
        <NumberField
          label="Wiederholungen"
          value={form.repeat}
          min={0}
          onChange={(v) => setForm((f) => ({ ...f, repeat: v ?? 0 }))}
          hint="Wie oft die ganze Kette nach der letzten Stufe erneut durchlaufen wird."
        />
      </div>
      <Hint>
        Eskalation startet, wenn ein Vorfall über eine Routing-Regel mit dieser Richtlinie benachrichtigt wurde. Jede Stufe feuert
        nach ihrer Wartezeit – gerechnet ab der vorherigen Stufe –, solange niemand bestätigt. Bestätigen stoppt die Eskalation
        sofort.
      </Hint>
      <div className="stack-sm">
        {form.steps.map((step, i) => (
          <div className="step-card" key={i}>
            <div className="step-head">
              <strong>Stufe {i + 1}</strong>
              <div className="row" style={{ gap: 4 }}>
                <button
                  type="button"
                  className="btn btn-ghost btn-xs btn-icon"
                  disabled={i === 0}
                  onClick={() => moveStep(i, -1)}
                  aria-label={`Stufe ${i + 1} nach oben`}
                  title="Nach oben"
                >
                  <Icon name="up" size={14} />
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-xs btn-icon"
                  disabled={i === form.steps.length - 1}
                  onClick={() => moveStep(i, 1)}
                  aria-label={`Stufe ${i + 1} nach unten`}
                  title="Nach unten"
                >
                  <Icon name="down" size={14} />
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-xs btn-icon"
                  disabled={form.steps.length === 1}
                  onClick={() => setForm((f) => ({ ...f, steps: f.steps.filter((_, idx) => idx !== i) }))}
                  aria-label={`Stufe ${i + 1} entfernen`}
                  title="Stufe entfernen"
                >
                  <Icon name="trash" size={14} />
                </button>
              </div>
            </div>
            <div className="step-delay">
              <span className="small muted">Nach</span>
              <div className="input-group">
                <input
                  className="input"
                  type="number"
                  min={0}
                  value={String(step.delayMinutes)}
                  aria-label={`Wartezeit Stufe ${i + 1} in Minuten`}
                  onChange={(e) => updateStep(i, { delayMinutes: Number(e.target.value) || 0 })}
                />
                <span className="input-addon">min</span>
              </div>
              <span className="small muted">ohne Bestätigung benachrichtigen:</span>
            </div>
            <CheckboxList
              options={channelOptions}
              value={step.channels}
              onChange={(v) => updateStep(i, { channels: v })}
              empty={
                <>
                  Noch keine Kanäle angelegt. <a href="#/channels">Kanal anlegen</a>
                </>
              }
            />
          </div>
        ))}
        <div>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() =>
              setForm((f) => ({
                ...f,
                steps: [...f.steps, { delayMinutes: f.steps[f.steps.length - 1]?.delayMinutes ?? 15, channels: [] }],
              }))
            }
          >
            <Icon name="plus" size={14} /> Stufe hinzufügen
          </button>
        </div>
      </div>
      {form.steps.length ? (
        <div className="stack-sm">
          <span className="section-title">So verhält sich die Richtlinie</span>
          <ul className="explain">
            {explainSteps(form.steps, form.repeat).map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <FormError error={action.error} />
    </Modal>
  );
}

export function EscalationPage() {
  const { canWrite } = useSession();
  const toast = useToast();
  const list = useApi<ListResponse<EscalationPolicy>>('/escalation-policies');
  const channels = useChannelMap();
  const [editing, setEditing] = useState<EscalationPolicy | 'new' | null>(null);

  const remove = async (p: EscalationPolicy) => {
    if (!window.confirm(`Eskalationsrichtlinie „${p.name}“ wirklich löschen?`)) return;
    try {
      await api.del(`/escalation-policies/${encodeURIComponent(p.id)}`);
      toast.success('Richtlinie gelöscht.');
      void list.reload();
      policyCache.invalidate();
    } catch (err) {
      toast.error(errorText(err));
    }
  };

  return (
    <div className="page">
      <PageHeader
        title="Eskalation"
        subtitle="Wer wird benachrichtigt, wenn niemand reagiert? Richtlinien werden in Routing-Regeln ausgewählt."
        actions={
          <button
            type="button"
            className="btn btn-primary"
            disabled={!canWrite}
            title={canWrite ? undefined : NO_WRITE_TITLE}
            onClick={() => setEditing('new')}
          >
            <Icon name="plus" size={15} /> Neue Richtlinie
          </button>
        }
      />
      <Card flush>
        <AsyncBlock
          data={list.data}
          error={list.error}
          loading={list.loading}
          onRetry={() => void list.reload()}
          isEmpty={(d) => d.items.length === 0}
          empty={
            <EmptyState title="Keine Eskalationsrichtlinien" icon="escalation">
              Beispiel: Stufe 1 nach 10 min an die Bereitschaft, Stufe 2 nach weiteren 20 min an das ganze Team.
            </EmptyState>
          }
        >
          {(data) => (
            <div className="list">
              {data.items.map((p) => (
                <div key={p.id} className="list-item">
                  <div className="list-main">
                    <div className="list-title">{p.name}</div>
                    <div className="chain">
                      <span className="chain-step">
                        <Icon name="send" size={12} /> Erste Benachrichtigung
                      </span>
                      {p.steps.map((s, i) => (
                        <span key={i} className="row" style={{ gap: 6 }}>
                          <span className="chain-arrow">→</span>
                          <span className="chain-step">
                            <strong>+{durationMinutes(s.delayMinutes)}</strong>
                            <span className="chips">
                              {s.channels.map((id) => (
                                <Chip key={id}>{channels.get(id)?.name ?? id}</Chip>
                              ))}
                            </span>
                          </span>
                        </span>
                      ))}
                      {p.repeat > 0 ? (
                        <span className="chain-step">
                          <Icon name="repeat" size={12} /> {p.repeat}× wiederholen
                        </span>
                      ) : null}
                    </div>
                    {p.steps[0] ? (
                      <span className="small muted">
                        Stufe 1 wird {durationMinutes(p.steps[0].delayMinutes)} nach der ersten Benachrichtigung ausgelöst, falls
                        niemand bestätigt.
                      </span>
                    ) : null}
                  </div>
                  <div className="list-side">
                    <button
                      type="button"
                      className="btn btn-sm btn-icon"
                      disabled={!canWrite}
                      onClick={() => setEditing(p)}
                      aria-label={`„${p.name}“ bearbeiten`}
                      title="Bearbeiten"
                    >
                      <Icon name="edit" size={14} />
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm btn-icon btn-danger"
                      disabled={!canWrite}
                      onClick={() => void remove(p)}
                      aria-label={`„${p.name}“ löschen`}
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
      {editing ? (
        <PolicyEditor
          policy={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(p) => {
            setEditing(null);
            toast.success(`Richtlinie „${p?.name ?? ''}“ gespeichert.`);
            void list.reload();
            policyCache.invalidate();
          }}
        />
      ) : null}
    </div>
  );
}
