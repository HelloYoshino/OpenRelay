import { useId, useState } from 'react';
import type { DeliveryMode, Route, Severity } from '@openrelay/types';
import { api } from '../../lib/api';
import { channelCache, policyCache } from '../../lib/cache';
import { useAction } from '../../lib/hooks';
import { DELIVERY_MODE_LABEL } from '../../lib/labels';
import {
  Checkbox,
  CheckboxList,
  cleanMatchers,
  Field,
  MatcherListEditor,
  NumberField,
  SeveritySelect,
  TextField,
  Toggle,
} from '../form';
import { Icon } from '../Icon';
import { Modal } from '../Modal';
import { FormError, Hint } from '../ui';

export type RouteInput = Omit<Route, 'id' | 'createdAt' | 'updatedAt'>;

export function routeInput(r: Route): RouteInput {
  return {
    name: r.name,
    position: r.position,
    enabled: r.enabled,
    matchers: r.matchers,
    channels: r.channels,
    delivery: r.delivery,
    digestMinutes: r.digestMinutes,
    escalationPolicyId: r.escalationPolicyId,
    quietHours: r.quietHours,
    notifyResolved: r.notifyResolved,
    stop: r.stop,
  };
}

const MODE_HINT: Record<DeliveryMode, string> = {
  auto: 'Ab dem in den Engine-Einstellungen festgelegten Schweregrad sofort, darunter gesammelt im Digest.',
  immediate: 'Jede Benachrichtigung wird sofort zugestellt.',
  digest: 'Benachrichtigungen werden gesammelt und periodisch als Zusammenfassung verschickt.',
};

const TIMEZONES = [
  'Europe/Berlin',
  'Europe/Vienna',
  'Europe/Zurich',
  'Europe/London',
  'UTC',
  'America/New_York',
  'America/Los_Angeles',
  'Asia/Tokyo',
];

function localTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Berlin';
  } catch {
    return 'Europe/Berlin';
  }
}

export function RouteEditor({
  route,
  nextPosition,
  onClose,
  onSaved,
}: {
  route: Route | null;
  nextPosition: number;
  onClose: () => void;
  onSaved: (route: Route) => void;
}) {
  const channels = channelCache.use();
  const policies = policyCache.use();
  const tzListId = useId();
  const [form, setForm] = useState<RouteInput>(() =>
    route
      ? routeInput(route)
      : {
          name: '',
          position: nextPosition,
          enabled: true,
          matchers: ['severity >= high'],
          channels: [],
          delivery: 'auto',
          digestMinutes: null,
          escalationPolicyId: null,
          quietHours: null,
          notifyResolved: true,
          stop: false,
        },
  );
  const action = useAction();
  const set = <K extends keyof RouteInput>(key: K, value: RouteInput[K]) => setForm((f) => ({ ...f, [key]: value }));
  const qh = form.quietHours;

  const save = async () => {
    if (!form.name.trim()) {
      action.setError('Bitte einen Namen angeben.');
      return;
    }
    if (qh && (!/^\d{2}:\d{2}$/.test(qh.start) || !/^\d{2}:\d{2}$/.test(qh.end))) {
      action.setError('Ruhezeiten brauchen Beginn und Ende im Format HH:MM.');
      return;
    }
    const body: RouteInput = {
      ...form,
      name: form.name.trim(),
      matchers: cleanMatchers(form.matchers),
      digestMinutes: form.digestMinutes && form.digestMinutes > 0 ? form.digestMinutes : null,
      quietHours: qh ? { ...qh, timezone: qh.timezone?.trim() || undefined } : null,
    };
    const res = await action.run(() =>
      route
        ? api.put<{ route: Route }>(`/routes/${encodeURIComponent(route.id)}`, body)
        : api.post<{ route: Route }>('/routes', body),
    );
    if (res.ok) onSaved(res.value.route);
  };

  return (
    <Modal
      title={route ? `Regel bearbeiten: ${route.name}` : 'Neue Routing-Regel'}
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
      <div className="form">
        <div className="form-section">
          <div className="grid-2">
            <TextField
              label="Name"
              required
              value={form.name}
              onChange={(v) => set('name', v)}
              placeholder="z. B. Kritisch → Telegram"
              autoFocus
            />
            <div className="field" style={{ justifyContent: 'flex-end' }}>
              <Toggle checked={form.enabled} onChange={(v) => set('enabled', v)} label="Aktiv" />
            </div>
          </div>
          <MatcherListEditor value={form.matchers} onChange={(v) => set('matchers', v)} />
        </div>

        <div className="form-section">
          <h3>Ziel</h3>
          <Field label="Kanäle">
            {channels === undefined ? (
              <span className="muted small">Lädt…</span>
            ) : (
              <CheckboxList
                options={channels.map((c) => ({
                  value: c.id,
                  label: (
                    <>
                      {c.name} <span className="muted small">· {c.type}</span>
                      {!c.enabled ? <span className="muted small"> · deaktiviert</span> : null}
                    </>
                  ),
                }))}
                value={form.channels}
                onChange={(v) => set('channels', v)}
                empty={
                  <>
                    Noch keine Kanäle angelegt. <a href="#/channels">Kanal anlegen</a>
                  </>
                }
              />
            )}
          </Field>
          {form.channels.length === 0 ? (
            <Hint>
              Ohne Kanäle wird nichts zugestellt. Zusammen mit „Weitere Regeln nicht auswerten“ lassen sich so Ereignisse gezielt
              ausfiltern.
            </Hint>
          ) : null}
          <Field label="Zustellung">
            <div className="stack-sm" role="radiogroup" aria-label="Zustellung">
              {(Object.keys(DELIVERY_MODE_LABEL) as DeliveryMode[]).map((mode) => (
                <label key={mode} className="check">
                  <input type="radio" name="delivery" checked={form.delivery === mode} onChange={() => set('delivery', mode)} />
                  <span className="check-text">
                    <span>{DELIVERY_MODE_LABEL[mode]}</span>
                    <span className="field-hint">{MODE_HINT[mode]}</span>
                  </span>
                </label>
              ))}
            </div>
          </Field>
          <div className="grid-2">
            <NumberField
              label="Digest-Intervall"
              value={form.digestMinutes}
              onChange={(v) => set('digestMinutes', v)}
              allowEmpty
              min={1}
              unit="min"
              hint="Leer = globale Einstellung"
            />
            <Field label="Eskalationsrichtlinie" htmlFor="route-policy">
              <select
                id="route-policy"
                className="input"
                value={form.escalationPolicyId ?? ''}
                onChange={(e) => set('escalationPolicyId', e.target.value || null)}
              >
                <option value="">Keine Eskalation</option>
                {(policies ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        </div>

        <div className="form-section">
          <h3>Ruhezeiten</h3>
          <Toggle
            checked={qh !== null}
            onChange={(on) =>
              set(
                'quietHours',
                on ? { start: '22:00', end: '07:00', timezone: localTimezone(), bypassSeverity: 'critical' } : null,
              )
            }
            label="Ruhezeiten aktivieren"
            hint="In diesem Zeitfenster werden Benachrichtigungen zurückgehalten – außer ab dem gewählten Schweregrad."
          />
          {qh ? (
            <div className="form-grid">
              <TextField
                label="Beginn"
                type="time"
                value={qh.start}
                onChange={(v) => set('quietHours', { ...qh, start: v })}
                required
              />
              <TextField
                label="Ende"
                type="time"
                value={qh.end}
                onChange={(v) => set('quietHours', { ...qh, end: v })}
                required
              />
              <TextField
                label="Zeitzone"
                value={qh.timezone ?? ''}
                onChange={(v) => set('quietHours', { ...qh, timezone: v })}
                list={tzListId}
                placeholder="Server-Zeitzone"
              />
              <Field label="Trotzdem senden ab">
                <SeveritySelect
                  value={qh.bypassSeverity ?? 'critical'}
                  onChange={(v) => set('quietHours', { ...qh, bypassSeverity: (v || 'critical') as Severity })}
                  ariaLabel="Schweregrad, der Ruhezeiten ignoriert"
                />
              </Field>
              <datalist id={tzListId}>
                {TIMEZONES.map((tz) => (
                  <option key={tz} value={tz} />
                ))}
              </datalist>
            </div>
          ) : null}
        </div>

        <div className="form-section">
          <h3>Verhalten</h3>
          <Checkbox
            checked={form.notifyResolved}
            onChange={(v) => set('notifyResolved', v)}
            label="Auch bei Lösung benachrichtigen"
            hint="Schickt eine Nachricht, wenn der Vorfall gelöst wurde."
          />
          <Checkbox
            checked={form.stop}
            onChange={(v) => set('stop', v)}
            label="Weitere Regeln nicht auswerten"
            hint="Trifft diese Regel zu, werden nachfolgende Regeln übersprungen."
          />
        </div>
        <FormError error={action.error} />
      </div>
      {action.error ? null : (
        <span className="muted small">
          <Icon name="info" size={12} /> Regeln werden von oben nach unten ausgewertet.
        </span>
      )}
    </Modal>
  );
}
