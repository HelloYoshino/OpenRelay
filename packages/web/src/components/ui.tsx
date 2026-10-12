import { useState, type ReactNode } from 'react';
import { absTime, num, relTime } from '../lib/format';
import { useNow } from '../lib/hooks';
import { Icon, type IconName } from './Icon';

export function RelTime({ ts, prefix }: { ts: number | null | undefined; prefix?: string }) {
  useNow(); // re-render periodically
  if (ts === null || ts === undefined) return <span className="muted">–</span>;
  return (
    <time dateTime={new Date(ts).toISOString()} title={absTime(ts)} className="reltime">
      {prefix ? `${prefix} ` : ''}
      {relTime(ts)}
    </time>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="spinner-wrap" role="status">
      <span className="spinner" aria-hidden />
      {label ? <span>{label}</span> : <span className="sr-only">Lädt…</span>}
    </span>
  );
}

export function Loading({ label = 'Lädt…' }: { label?: string }) {
  return (
    <div className="state state-loading">
      <Spinner label={label} />
    </div>
  );
}

export function EmptyState({
  title,
  children,
  icon = 'checkCircle',
  action,
}: {
  title: string;
  children?: ReactNode;
  icon?: IconName;
  action?: ReactNode;
}) {
  return (
    <div className="state state-empty">
      <Icon name={icon} size={28} />
      <div className="state-title">{title}</div>
      {children ? <div className="state-text">{children}</div> : null}
      {action ? <div className="state-action">{action}</div> : null}
    </div>
  );
}

export function ErrorBox({ error, onRetry, compact }: { error: Error | string; onRetry?: () => void; compact?: boolean }) {
  const message = typeof error === 'string' ? error : error.message;
  return (
    <div className={`alert-box tone-critical${compact ? ' compact' : ''}`} role="alert">
      <Icon name="alert" size={16} />
      <div className="alert-body">
        {!compact ? <strong>Fehler beim Laden</strong> : null}
        <span>{message}</span>
      </div>
      {onRetry ? (
        <button type="button" className="btn btn-sm" onClick={onRetry}>
          <Icon name="refresh" size={14} /> Erneut versuchen
        </button>
      ) : null}
    </div>
  );
}

export function FormError({ error }: { error: string | null | undefined }) {
  if (!error) return null;
  return (
    <div className="alert-box tone-critical compact" role="alert">
      <Icon name="alert" size={16} />
      <div className="alert-body">
        <span>{error}</span>
      </div>
    </div>
  );
}

export function Hint({ children, icon = 'info' }: { children: ReactNode; icon?: IconName }) {
  return (
    <div className="hint">
      <Icon name={icon} size={16} />
      <div>{children}</div>
    </div>
  );
}

/**
 * Renders loading / error / empty / content for one async list.
 */
export function AsyncBlock<T>({
  data,
  error,
  loading,
  onRetry,
  isEmpty,
  empty,
  children,
}: {
  data: T | undefined;
  error: Error | null;
  loading: boolean;
  onRetry?: () => void;
  isEmpty?: (data: T) => boolean;
  empty?: ReactNode;
  children: (data: T) => ReactNode;
}) {
  if (data === undefined) {
    if (error && !loading) return <ErrorBox error={error} onRetry={onRetry} />;
    return <Loading />;
  }
  return (
    <>
      {error ? <ErrorBox error={error} onRetry={onRetry} compact /> : null}
      {isEmpty && isEmpty(data) ? empty : children(data)}
    </>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
  icon,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  icon?: IconName;
}) {
  return (
    <div className="page-header">
      <div className="page-header-text">
        <h1>
          {icon ? <Icon name={icon} size={20} /> : null}
          {title}
        </h1>
        {subtitle ? <p className="page-subtitle">{subtitle}</p> : null}
      </div>
      {actions ? <div className="page-actions">{actions}</div> : null}
    </div>
  );
}

export function Card({
  title,
  actions,
  children,
  className,
  flush,
  id,
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  flush?: boolean;
  id?: string;
}) {
  return (
    <section className={`card${flush ? ' flush' : ''}${className ? ` ${className}` : ''}`} id={id}>
      {title || actions ? (
        <header className="card-header">
          {title ? <h2 className="card-title">{title}</h2> : <span />}
          {actions ? <div className="card-actions">{actions}</div> : null}
        </header>
      ) : null}
      <div className="card-body">{children}</div>
    </section>
  );
}

export interface TabItem<K extends string> {
  key: K;
  label: ReactNode;
  count?: number;
}

export function Tabs<K extends string>({
  items,
  value,
  onChange,
  label,
}: {
  items: TabItem<K>[];
  value: K;
  onChange: (key: K) => void;
  label: string;
}) {
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          role="tab"
          aria-selected={item.key === value}
          className={`tab${item.key === value ? ' active' : ''}`}
          onClick={() => onChange(item.key)}
        >
          {item.label}
          {item.count !== undefined ? <span className="tab-count">{num(item.count)}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function Pagination({
  offset,
  limit,
  total,
  onChange,
}: {
  offset: number;
  limit: number;
  total: number;
  onChange: (offset: number) => void;
}) {
  if (total <= limit && offset === 0) return null;
  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + limit, total);
  const page = Math.floor(offset / limit) + 1;
  const pages = Math.max(1, Math.ceil(total / limit));
  return (
    <nav className="pagination" aria-label="Seiten">
      <span className="muted">
        {num(from)}–{num(to)} von {num(total)}
      </span>
      <div className="pagination-buttons">
        <button type="button" className="btn btn-sm" disabled={offset <= 0} onClick={() => onChange(Math.max(0, offset - limit))}>
          <Icon name="left" size={14} /> Zurück
        </button>
        <span className="muted">
          Seite {page} / {pages}
        </span>
        <button type="button" className="btn btn-sm" disabled={offset + limit >= total} onClick={() => onChange(offset + limit)}>
          Weiter <Icon name="right" size={14} />
        </button>
      </div>
    </nav>
  );
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}

export function CopyButton({ text, label = 'Kopieren' }: { text: string; label?: string }) {
  const [state, setState] = useState<'idle' | 'ok' | 'fail'>('idle');
  return (
    <button
      type="button"
      className="btn btn-sm"
      onClick={async () => {
        const ok = await copyText(text);
        setState(ok ? 'ok' : 'fail');
        setTimeout(() => setState('idle'), 1800);
      }}
    >
      <Icon name={state === 'ok' ? 'check' : 'copy'} size={14} />
      {state === 'ok' ? 'Kopiert' : state === 'fail' ? 'Fehlgeschlagen' : label}
    </button>
  );
}

export function KeyValue({ items }: { items: [ReactNode, ReactNode][] }) {
  return (
    <dl className="kv">
      {items.map(([k, v], i) => (
        <div className="kv-row" key={i}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}
