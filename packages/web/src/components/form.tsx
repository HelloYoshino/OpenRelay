import { useId, useState, type ReactNode } from 'react';
import type { Severity } from '@openrelay/types';
import { SEVERITY_LABEL, SEVERITY_ORDER } from '../lib/labels';
import { Icon } from './Icon';

export function Field({
  label,
  hint,
  children,
  htmlFor,
  required,
  className,
}: {
  label: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
  htmlFor?: string;
  required?: boolean;
  className?: string;
}) {
  return (
    <div className={`field${className ? ` ${className}` : ''}`}>
      <label className="field-label" htmlFor={htmlFor}>
        {label}
        {required ? (
          <span className="req" aria-hidden>
            {' '}
            *
          </span>
        ) : null}
      </label>
      {children}
      {hint ? <div className="field-hint">{hint}</div> : null}
    </div>
  );
}

/** Text/number input with its own label. */
export function TextField({
  label,
  value,
  onChange,
  hint,
  type = 'text',
  placeholder,
  required,
  list,
  autoFocus,
  mono,
  className,
}: {
  label: ReactNode;
  value: string;
  onChange: (value: string) => void;
  hint?: ReactNode;
  type?: 'text' | 'password' | 'url' | 'email' | 'time' | 'datetime-local';
  placeholder?: string;
  required?: boolean;
  list?: string;
  autoFocus?: boolean;
  mono?: boolean;
  className?: string;
}) {
  const id = useId();
  return (
    <Field label={label} hint={hint} htmlFor={id} required={required} className={className}>
      <input
        id={id}
        className={`input${mono ? ' mono' : ''}`}
        type={type}
        value={value}
        placeholder={placeholder}
        required={required}
        list={list}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
  );
}

export function NumberField({
  label,
  value,
  onChange,
  hint,
  min,
  max,
  step,
  unit,
  allowEmpty,
  required,
}: {
  label: ReactNode;
  value: number | null;
  onChange: (value: number | null) => void;
  hint?: ReactNode;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  allowEmpty?: boolean;
  required?: boolean;
}) {
  const id = useId();
  return (
    <Field label={label} hint={hint} htmlFor={id} required={required}>
      <div className="input-group">
        <input
          id={id}
          className="input"
          type="number"
          inputMode="decimal"
          value={value === null || Number.isNaN(value) ? '' : String(value)}
          min={min}
          max={max}
          step={step ?? 1}
          required={required}
          onChange={(e) => {
            const raw = e.target.value;
            if (raw === '') onChange(allowEmpty ? null : 0);
            else {
              const n = Number(raw);
              if (Number.isFinite(n)) onChange(n);
            }
          }}
        />
        {unit ? <span className="input-addon">{unit}</span> : null}
      </div>
    </Field>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  hint,
  disabled,
  title,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: ReactNode;
  hint?: ReactNode;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <label className={`toggle${disabled ? ' disabled' : ''}`} title={title}>
      <input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="toggle-track" aria-hidden>
        <span className="toggle-thumb" />
      </span>
      {label ? (
        <span className="toggle-text">
          <span>{label}</span>
          {hint ? <span className="field-hint">{hint}</span> : null}
        </span>
      ) : null}
    </label>
  );
}

export function Checkbox({
  checked,
  onChange,
  label,
  hint,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: ReactNode;
  hint?: ReactNode;
  disabled?: boolean;
}) {
  return (
    <label className={`check${disabled ? ' disabled' : ''}`}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="check-text">
        <span>{label}</span>
        {hint ? <span className="field-hint">{hint}</span> : null}
      </span>
    </label>
  );
}

export function SeveritySelect({
  value,
  onChange,
  allowEmpty,
  emptyLabel = 'Alle Schweregrade',
  id,
  ariaLabel,
}: {
  value: Severity | '';
  onChange: (value: Severity | '') => void;
  allowEmpty?: boolean;
  emptyLabel?: string;
  id?: string;
  ariaLabel?: string;
}) {
  return (
    <select
      id={id}
      className="input"
      value={value}
      aria-label={ariaLabel}
      onChange={(e) => onChange(e.target.value as Severity | '')}
    >
      {allowEmpty ? <option value="">{emptyLabel}</option> : null}
      {SEVERITY_ORDER.map((s) => (
        <option key={s} value={s}>
          {SEVERITY_LABEL[s]}
        </option>
      ))}
    </select>
  );
}

/** Multi-select as a checkbox list. */
export function CheckboxList<V extends string>({
  options,
  value,
  onChange,
  empty,
}: {
  options: { value: V; label: ReactNode; hint?: ReactNode; disabled?: boolean }[];
  value: V[];
  onChange: (value: V[]) => void;
  empty?: ReactNode;
}) {
  if (options.length === 0) return <div className="muted small">{empty ?? 'Keine Einträge vorhanden.'}</div>;
  return (
    <div className="checkbox-list">
      {options.map((opt) => (
        <Checkbox
          key={opt.value}
          label={opt.label}
          hint={opt.hint}
          disabled={opt.disabled}
          checked={value.includes(opt.value)}
          onChange={(checked) => onChange(checked ? [...value, opt.value] : value.filter((v) => v !== opt.value))}
        />
      ))}
    </div>
  );
}

export const MATCHER_EXAMPLES = [
  'severity >= high',
  'labels.env = prod',
  'service =~ ^api-',
  'source in [github, gitlab]',
  'host = web-*',
];

export function MatcherCheatSheet() {
  return (
    <div className="cheatsheet">
      <p>
        Bedingungen haben die Form <code>&lt;feld&gt; &lt;operator&gt; &lt;wert&gt;</code>. Alle Bedingungen müssen zutreffen;
        keine Bedingung = trifft immer zu.
      </p>
      <dl>
        <dt>Felder</dt>
        <dd>
          <code>severity</code> <code>status</code> <code>priority</code> <code>source</code> <code>type</code> <code>title</code>{' '}
          <code>message</code> <code>service</code> <code>host</code> <code>correlationKey</code> <code>labels.&lt;name&gt;</code>{' '}
          – bei Vorfällen zusätzlich <code>services</code>, <code>sources</code> (trifft zu, wenn ein Element passt)
        </dd>
        <dt>Operatoren</dt>
        <dd>
          <code>=</code> (mit <code>*</code>-Wildcards) <code>!=</code> <code>=~</code> (Regex) <code>!~</code> <code>&gt;=</code>{' '}
          <code>&gt;</code> <code>&lt;=</code> <code>&lt;</code> (für <code>severity</code> nach Schweregrad, sonst numerisch){' '}
          <code>in [a, b]</code> <code>not in [a, b]</code> <code>exists</code> <code>missing</code>
        </dd>
        <dt>Beispiele</dt>
        <dd>
          {MATCHER_EXAMPLES.map((ex) => (
            <code key={ex}>{ex}</code>
          ))}
        </dd>
      </dl>
    </div>
  );
}

/** Dynamic list of matcher expressions with a syntax cheat sheet. */
export function MatcherListEditor({
  value,
  onChange,
  label = 'Bedingungen',
  emptyHint = 'Keine Bedingungen – trifft auf alles zu.',
  placeholder = 'z. B. severity >= high',
}: {
  value: string[];
  onChange: (value: string[]) => void;
  label?: ReactNode;
  emptyHint?: ReactNode;
  placeholder?: string;
}) {
  const [showHelp, setShowHelp] = useState(false);
  const baseId = useId();
  const update = (index: number, text: string) => onChange(value.map((v, i) => (i === index ? text : v)));
  const remove = (index: number) => onChange(value.filter((_, i) => i !== index));
  return (
    <div className="field matcher-editor">
      <div className="field-label-row">
        <span className="field-label">{label}</span>
        <button type="button" className="btn btn-ghost btn-xs" onClick={() => setShowHelp((s) => !s)} aria-expanded={showHelp}>
          <Icon name="info" size={13} /> Syntax
        </button>
      </div>
      {showHelp ? <MatcherCheatSheet /> : null}
      {value.length === 0 ? <div className="field-hint">{emptyHint}</div> : null}
      <div className="matcher-rows">
        {value.map((m, i) => (
          <div className="matcher-row" key={i}>
            <input
              id={`${baseId}-${i}`}
              className="input mono"
              value={m}
              placeholder={placeholder}
              aria-label={`Bedingung ${i + 1}`}
              onChange={(e) => update(i, e.target.value)}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
            />
            <button
              type="button"
              className="btn btn-icon btn-ghost"
              onClick={() => remove(i)}
              title="Bedingung entfernen"
              aria-label="Bedingung entfernen"
            >
              <Icon name="x" size={14} />
            </button>
          </div>
        ))}
      </div>
      <div>
        <button type="button" className="btn btn-sm" onClick={() => onChange([...value, ''])}>
          <Icon name="plus" size={14} /> Bedingung
        </button>
      </div>
    </div>
  );
}

export function cleanMatchers(list: string[]): string[] {
  return list.map((m) => m.trim()).filter(Boolean);
}
