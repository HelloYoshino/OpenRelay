import { useId, useMemo, useState } from 'react';
import type { Channel } from '@openrelay/types';
import { api } from '../../lib/api';
import type { ChannelTypeInfo, ConfigField } from '../../lib/apiTypes';
import { useAction } from '../../lib/hooks';
import { Field, TextField, Toggle } from '../form';
import { Icon } from '../Icon';
import { Modal } from '../Modal';
import { FormError } from '../ui';

export const SECRET_MASK = '••••••';

type ConfigValues = Record<string, unknown>;

function defaultsFor(schema: ConfigField[]): ConfigValues {
  const values: ConfigValues = {};
  for (const f of schema) {
    if (f.default !== undefined) values[f.key] = f.default;
    else if (f.type === 'boolean') values[f.key] = false;
  }
  return values;
}

function isEmpty(v: unknown): boolean {
  return v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
}

function ConfigFieldInput({ field, value, onChange }: { field: ConfigField; value: unknown; onChange: (v: unknown) => void }) {
  const id = useId();
  const [reveal, setReveal] = useState(false);
  const hint = field.help;
  switch (field.type) {
    case 'boolean':
      return <Toggle checked={value === true} onChange={onChange} label={field.label} hint={hint} />;
    case 'number':
      return (
        <Field label={field.label} hint={hint} htmlFor={id} required={field.required}>
          <input
            id={id}
            className="input"
            type="number"
            value={typeof value === 'number' ? String(value) : typeof value === 'string' ? value : ''}
            placeholder={field.placeholder}
            required={field.required}
            onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
          />
        </Field>
      );
    case 'select':
      return (
        <Field label={field.label} hint={hint} htmlFor={id} required={field.required}>
          <select
            id={id}
            className="input"
            value={typeof value === 'string' ? value : value === undefined ? '' : String(value)}
            required={field.required}
            onChange={(e) => onChange(e.target.value || undefined)}
          >
            {!field.required || isEmpty(value) ? <option value="">{field.placeholder ?? '– bitte wählen –'}</option> : null}
            {(field.options ?? []).map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>
      );
    case 'text':
      return (
        <Field label={field.label} hint={hint} htmlFor={id} required={field.required}>
          <textarea
            id={id}
            className="input"
            rows={4}
            value={typeof value === 'string' ? value : value === undefined || value === null ? '' : JSON.stringify(value)}
            placeholder={field.placeholder}
            required={field.required}
            onChange={(e) => onChange(e.target.value)}
          />
        </Field>
      );
    case 'secret': {
      const masked = value === SECRET_MASK;
      return (
        <Field
          label={field.label}
          hint={masked ? 'Gespeichert. Unverändert lassen, um den bisherigen Wert zu behalten.' : hint}
          htmlFor={id}
          required={field.required}
        >
          <div className="input-group">
            <input
              id={id}
              className="input mono"
              type={reveal && !masked ? 'text' : 'password'}
              autoComplete="new-password"
              value={typeof value === 'string' ? value : ''}
              placeholder={field.placeholder}
              required={field.required}
              onFocus={(e) => {
                if (masked) e.currentTarget.select();
              }}
              onChange={(e) => onChange(e.target.value)}
            />
            <button
              type="button"
              className="btn"
              disabled={masked}
              onClick={() => setReveal((r) => !r)}
              aria-label={reveal ? 'Wert verbergen' : 'Wert anzeigen'}
              title={masked ? 'Gespeicherte Werte werden nicht angezeigt' : reveal ? 'Wert verbergen' : 'Wert anzeigen'}
            >
              <Icon name={reveal ? 'eyeOff' : 'eye'} size={14} />
            </button>
          </div>
        </Field>
      );
    }
    default:
      return (
        <TextField
          label={field.label}
          hint={hint}
          value={typeof value === 'string' ? value : value === undefined || value === null ? '' : String(value)}
          placeholder={field.placeholder}
          required={field.required}
          onChange={onChange}
        />
      );
  }
}

export function ChannelEditor({
  channel,
  types,
  onClose,
  onSaved,
}: {
  channel: Channel | null;
  types: ChannelTypeInfo[];
  onClose: () => void;
  onSaved: (channel: Channel) => void;
}) {
  const [type, setType] = useState(channel?.type ?? types[0]?.type ?? '');
  const info = useMemo(() => types.find((t) => t.type === type), [types, type]);
  const [name, setName] = useState(channel?.name ?? '');
  const [enabled, setEnabled] = useState(channel?.enabled ?? true);
  const [config, setConfig] = useState<ConfigValues>(() => {
    const defaults = defaultsFor(types.find((t) => t.type === type)?.configSchema ?? []);
    return channel ? { ...defaults, ...channel.config } : defaults;
  });
  const action = useAction();

  const changeType = (next: string) => {
    setType(next);
    setConfig(defaultsFor(types.find((t) => t.type === next)?.configSchema ?? []));
  };

  const save = async () => {
    if (!name.trim()) {
      action.setError('Bitte einen Namen angeben.');
      return;
    }
    if (!type) {
      action.setError('Bitte einen Kanaltyp wählen.');
      return;
    }
    const missing = (info?.configSchema ?? []).filter((f) => f.required && f.type !== 'boolean' && isEmpty(config[f.key]));
    if (missing.length) {
      action.setError(`Pflichtfelder fehlen: ${missing.map((f) => f.label).join(', ')}`);
      return;
    }
    const cleaned: ConfigValues = {};
    for (const [k, v] of Object.entries(config)) {
      if (v === undefined || (typeof v === 'number' && Number.isNaN(v))) continue;
      cleaned[k] = v;
    }
    const body = { name: name.trim(), type, enabled, config: cleaned };
    const res = await action.run(() =>
      channel
        ? api.put<{ channel: Channel }>(`/channels/${encodeURIComponent(channel.id)}`, body)
        : api.post<{ channel: Channel }>('/channels', body),
    );
    if (res.ok) onSaved(res.value.channel);
  };

  return (
    <Modal
      title={channel ? `Kanal bearbeiten: ${channel.name}` : 'Neuer Kanal'}
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
            <Field label="Typ" htmlFor="channel-type" required>
              <select
                id="channel-type"
                className="input"
                value={type}
                disabled={!!channel}
                onChange={(e) => changeType(e.target.value)}
              >
                {!types.some((t) => t.type === type) && type ? <option value={type}>{type}</option> : null}
                {types.map((t) => (
                  <option key={t.type} value={t.type}>
                    {t.displayName}
                  </option>
                ))}
              </select>
            </Field>
            <TextField
              label="Name"
              required
              value={name}
              onChange={setName}
              placeholder={info ? `z. B. ${info.displayName} Ops` : ''}
              autoFocus
            />
          </div>
          {info?.description ? <p className="muted small">{info.description}</p> : null}
          <Toggle
            checked={enabled}
            onChange={setEnabled}
            label="Aktiv"
            hint="Deaktivierte Kanäle erhalten keine Benachrichtigungen."
          />
        </div>
        <div className="form-section">
          <h3>Konfiguration</h3>
          {!info ? (
            <p className="muted small">Für diesen Typ ist kein Formular verfügbar (Plugin nicht geladen?).</p>
          ) : info.configSchema.length === 0 ? (
            <p className="muted small">Dieser Kanaltyp benötigt keine Konfiguration.</p>
          ) : (
            <div className="grid-2">
              {info.configSchema.map((f) => (
                <div key={f.key} style={f.type === 'text' ? { gridColumn: '1 / -1' } : undefined}>
                  <ConfigFieldInput field={f} value={config[f.key]} onChange={(v) => setConfig((c) => ({ ...c, [f.key]: v }))} />
                </div>
              ))}
            </div>
          )}
        </div>
        <FormError error={action.error} />
      </div>
    </Modal>
  );
}
