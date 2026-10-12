import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { EngineSettings, Severity } from '@openrelay/types';
import { api } from '../../lib/api';
import { splitList } from '../../lib/format';
import { useAction, useApi } from '../../lib/hooks';
import { NO_WRITE_TITLE, useSession } from '../../lib/session';
import { Checkbox, Field, NumberField, SeveritySelect, TextField, Toggle } from '../../components/form';
import { useToast } from '../../components/Toast';
import { Card, ErrorBox, FormError, Loading } from '../../components/ui';

type Sections = Omit<EngineSettings, 'locale' | 'volumeRules' | 'eventRules'>;
type EngineDraft = Sections & { locale: EngineSettings['locale'] };

const WEIGHTS: { key: keyof EngineSettings['correlation']['weights']; label: string; hint: string }[] = [
  { key: 'learned', label: 'Gelernt', hint: 'Aus manuellen Zusammenführungen und Trennungen' },
  { key: 'topology', label: 'Topologie', hint: 'Services hängen laut Topologie voneinander ab' },
  { key: 'service', label: 'Service', hint: 'Gleicher Service' },
  { key: 'host', label: 'Host', hint: 'Gleicher Host' },
  { key: 'label', label: 'Labels', hint: 'Gleiche Werte in den Gruppierungs-Labels' },
  { key: 'similarity', label: 'Ähnlichkeit', hint: 'Ähnliche Titel' },
  { key: 'source', label: 'Quelle', hint: 'Gleiche Quelle' },
];

function pick(s: EngineSettings): EngineDraft {
  return {
    locale: s.locale,
    dedup: { ...s.dedup },
    correlation: {
      ...s.correlation,
      groupByLabels: [...(s.correlation.groupByLabels ?? [])],
      weights: { ...s.correlation.weights },
    },
    flapping: { ...s.flapping },
    storm: { ...s.storm },
    notifications: { ...s.notifications },
    priority: { ...s.priority },
    recurrence: { ...s.recurrence },
    retention: { ...s.retention },
  };
}

function Section({ title, description, children }: { title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <Card title={title}>
      <div className="stack">
        {description ? <p className="muted small">{description}</p> : null}
        {children}
      </div>
    </Card>
  );
}

export function EngineSettingsTab() {
  const { canWrite } = useSession();
  const toast = useToast();
  const remote = useApi<{ settings: EngineSettings }>('/settings');
  const [draft, setDraft] = useState<EngineDraft | null>(null);
  const [groupBy, setGroupBy] = useState('');
  const action = useAction();

  const reset = (s: EngineSettings) => {
    setDraft(pick(s));
    setGroupBy((s.correlation.groupByLabels ?? []).join(', '));
  };

  useEffect(() => {
    if (remote.data && draft === null) reset(remote.data.settings);
  }, [remote.data, draft]);

  const original = useMemo(() => (remote.data ? pick(remote.data.settings) : null), [remote.data]);

  if (!draft || !original) {
    return remote.error ? <ErrorBox error={remote.error} onRetry={() => void remote.reload()} /> : <Loading />;
  }

  const effective: EngineDraft = { ...draft, correlation: { ...draft.correlation, groupByLabels: splitList(groupBy) } };
  const dirty = JSON.stringify(effective) !== JSON.stringify(original);

  const set = <S extends keyof Sections, K extends keyof Sections[S]>(section: S, key: K, value: Sections[S][K]) =>
    setDraft((d) => (d ? { ...d, [section]: { ...d[section], [key]: value } } : d));
  const setWeight = (key: keyof EngineSettings['correlation']['weights'], value: number) =>
    setDraft((d) => (d ? { ...d, correlation: { ...d.correlation, weights: { ...d.correlation.weights, [key]: value } } } : d));
  const n = (v: number | null) => v ?? 0;

  const save = async () => {
    const res = await action.run(() => api.put<{ settings: EngineSettings }>('/settings', { settings: effective }));
    if (res.ok) {
      toast.success('Engine-Einstellungen gespeichert.');
      if (res.value?.settings) {
        remote.setData({ settings: res.value.settings });
        reset(res.value.settings);
      } else void remote.reload();
    }
  };

  const disabled = !canWrite;

  return (
    <form
      className="settings-sections"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <fieldset disabled={disabled} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }} className="settings-sections">
        <Section
          title="Deduplizierung"
          description="Gleiche Ereignisse (gleicher Fingerprint) werden zu einem Alarm zusammengefasst."
        >
          <div className="form-grid">
            <NumberField
              label="Wiedereröffnungsfenster"
              unit="min"
              min={0}
              value={draft.dedup.reopenWindowMinutes}
              onChange={(v) => set('dedup', 'reopenWindowMinutes', n(v))}
              hint="Feuert ein gelöster Alarm innerhalb dieser Zeit erneut, wird er wieder geöffnet statt neu angelegt."
            />
            <NumberField
              label="Automatisch lösen nach"
              unit="min"
              min={0}
              value={draft.dedup.autoResolveMinutes}
              onChange={(v) => set('dedup', 'autoResolveMinutes', n(v))}
              hint="Alarme ohne neue Ereignisse werden nach dieser Ruhezeit gelöst. 0 = nie."
            />
          </div>
        </Section>

        <Section
          title="Korrelation"
          description="Bündelt zusammengehörige Alarme zu einem Vorfall. Der Score ergibt sich aus den gewichteten Signalen."
        >
          <Toggle
            checked={draft.correlation.enabled}
            onChange={(v) => set('correlation', 'enabled', v)}
            label="Korrelation aktiv"
          />
          <div className="form-grid">
            <NumberField
              label="Zeitfenster"
              unit="min"
              min={0}
              value={draft.correlation.windowMinutes}
              onChange={(v) => set('correlation', 'windowMinutes', n(v))}
              hint="Maximale Zeit seit der letzten Aktivität eines Vorfalls, um neue Alarme anzuhängen."
            />
            <NumberField
              label="Schwelle Zuordnung"
              min={0}
              step={0.05}
              value={draft.correlation.threshold}
              onChange={(v) => set('correlation', 'threshold', n(v))}
              hint="Score, ab dem ein Alarm einem bestehenden Vorfall zugeordnet wird."
            />
            <NumberField
              label="Schwelle „verwandt“"
              min={0}
              step={0.05}
              value={draft.correlation.relatedThreshold}
              onChange={(v) => set('correlation', 'relatedThreshold', n(v))}
              hint="Score, ab dem ein neuer Vorfall als verwandt verknüpft wird."
            />
            <TextField
              label="Gruppierungs-Labels"
              value={groupBy}
              onChange={setGroupBy}
              placeholder="z. B. env, cluster, region"
              hint="Kommagetrennt. Gleiche Werte deuten auf Zusammenhang hin."
              mono
            />
          </div>
          <div className="stack-sm">
            <span className="field-label">Gewichtung der Signale</span>
            {WEIGHTS.map((w) => (
              <div className="range-field" key={w.key} title={w.hint}>
                <label htmlFor={`weight-${w.key}`}>
                  {w.label}
                  <span className="field-hint" style={{ display: 'block' }}>
                    {w.hint}
                  </span>
                </label>
                <input
                  id={`weight-${w.key}`}
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={draft.correlation.weights[w.key]}
                  onChange={(e) => setWeight(w.key, Number(e.target.value))}
                />
                <output htmlFor={`weight-${w.key}`}>{draft.correlation.weights[w.key].toFixed(2)}</output>
              </div>
            ))}
          </div>
        </Section>

        <Section
          title="Flattern"
          description="Alarme, die ständig zwischen aktiv und gelöst wechseln, werden markiert und gedämpft."
        >
          <Toggle
            checked={draft.flapping.enabled}
            onChange={(v) => set('flapping', 'enabled', v)}
            label="Flatter-Erkennung aktiv"
          />
          <div className="form-grid">
            <NumberField
              label="Zeitfenster"
              unit="min"
              min={1}
              value={draft.flapping.windowMinutes}
              onChange={(v) => set('flapping', 'windowMinutes', n(v))}
            />
            <NumberField
              label="Zustandswechsel"
              min={1}
              value={draft.flapping.threshold}
              onChange={(v) => set('flapping', 'threshold', n(v))}
              hint="Anzahl Wechsel im Fenster, ab der ein Alarm als flatternd gilt."
            />
          </div>
        </Section>

        <Section
          title="Alarm-Sturm"
          description="Kommen sehr viele neue Alarme gleichzeitig, werden sie in einem Sturm-Vorfall gebündelt."
        >
          <Toggle checked={draft.storm.enabled} onChange={(v) => set('storm', 'enabled', v)} label="Sturm-Erkennung aktiv" />
          <div className="form-grid">
            <NumberField
              label="Zeitfenster"
              unit="s"
              min={1}
              value={draft.storm.windowSeconds}
              onChange={(v) => set('storm', 'windowSeconds', n(v))}
            />
            <NumberField
              label="Neue Alarme"
              min={1}
              value={draft.storm.threshold}
              onChange={(v) => set('storm', 'threshold', n(v))}
              hint="Anzahl neuer Alarme im Fenster, ab der der Sturm-Modus greift."
            />
          </div>
        </Section>

        <Section title="Benachrichtigungen">
          <div className="form-grid">
            <Field label="Sofort ab Schweregrad" hint="Bei Zustellung „Automatisch“: ab hier sofort, darunter im Digest.">
              <SeveritySelect
                value={draft.notifications.immediateSeverity}
                onChange={(v) => set('notifications', 'immediateSeverity', (v || 'high') as Severity)}
                ariaLabel="Sofort ab Schweregrad"
              />
            </Field>
            <NumberField
              label="Digest-Intervall"
              unit="min"
              min={1}
              value={draft.notifications.digestMinutes}
              onChange={(v) => set('notifications', 'digestMinutes', n(v))}
            />
          </div>
          <Checkbox
            checked={draft.notifications.criticalBypassDigest}
            onChange={(v) => set('notifications', 'criticalBypassDigest', v)}
            label="Kritische Vorfälle umgehen den Digest"
            hint="Auch auf Routen mit „Sammeln (Digest)“ werden kritische Vorfälle sofort zugestellt."
          />
        </Section>

        <div className="grid-2" style={{ alignItems: 'start' }}>
          <Section title="Priorität">
            <NumberField
              label="Breite Auswirkung ab"
              unit="Services"
              min={0}
              value={draft.priority.wideImpactServices}
              onChange={(v) => set('priority', 'wideImpactServices', n(v))}
              hint="Vorfälle mit mindestens so vielen Services erhalten eine Prioritätsstufe höher. 0 = aus."
            />
          </Section>
          <Section title="Wiederholungen">
            <NumberField
              label="Rückblick"
              unit="Tage"
              min={0}
              value={draft.recurrence.lookbackDays}
              onChange={(v) => set('recurrence', 'lookbackDays', n(v))}
              hint="Wie weit zurück nach demselben Problem gesucht wird („wiederkehrend ×N“)."
            />
          </Section>
        </div>

        <Section title="Aufbewahrung" description="Ältere Daten werden automatisch gelöscht.">
          <div className="form-grid">
            <NumberField
              label="Ereignisse"
              unit="Tage"
              min={1}
              value={draft.retention.eventsDays}
              onChange={(v) => set('retention', 'eventsDays', n(v))}
            />
            <NumberField
              label="Gelöste Vorfälle"
              unit="Tage"
              min={1}
              value={draft.retention.resolvedIncidentsDays}
              onChange={(v) => set('retention', 'resolvedIncidentsDays', n(v))}
            />
            <NumberField
              label="Zustellungen"
              unit="Tage"
              min={1}
              value={draft.retention.deliveriesDays}
              onChange={(v) => set('retention', 'deliveriesDays', n(v))}
            />
          </div>
        </Section>

        <Section title="Sprache">
          <Field label="Sprache der Benachrichtigungen" htmlFor="engine-locale">
            <select
              id="engine-locale"
              className="input"
              style={{ maxWidth: 260 }}
              value={draft.locale}
              onChange={(e) => setDraft((d) => (d ? { ...d, locale: e.target.value as EngineSettings['locale'] } : d))}
            >
              <option value="de">Deutsch</option>
              <option value="en">English</option>
            </select>
          </Field>
        </Section>
      </fieldset>

      <div className="sticky-save">
        {!canWrite ? <span className="muted small">{NO_WRITE_TITLE}</span> : null}
        <FormError error={action.error} />
        {dirty ? <span className="muted small">Ungespeicherte Änderungen</span> : null}
        <button
          type="button"
          className="btn"
          disabled={!dirty || action.busy}
          onClick={() => remote.data && reset(remote.data.settings)}
        >
          Verwerfen
        </button>
        <button type="submit" className="btn btn-primary" disabled={!canWrite || !dirty || action.busy}>
          {action.busy ? 'Speichere…' : 'Speichern'}
        </button>
      </div>
    </form>
  );
}
