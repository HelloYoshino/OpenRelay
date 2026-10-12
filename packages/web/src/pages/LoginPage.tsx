import { useState, type FormEvent } from 'react';
import { ApiError, request } from '../lib/api';
import type { Me } from '../lib/apiTypes';
import { Icon } from '../components/Icon';
import { Logo } from '../components/Logo';
import { FormError } from '../components/ui';

export function LoginPage({ onLogin, expired }: { onLogin: (token: string, me: Me) => void; expired: boolean }) {
  const [token, setToken] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const value = token.trim();
    if (!value) {
      setError('Bitte ein Token eingeben.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const me = await request<Me>('/me', { token: value });
      const scopes = me.scopes ?? [];
      if (!scopes.includes('read') && !scopes.includes('admin')) {
        setError('Dieses Token hat nur den Scope „ingest“. Für das Dashboard wird „read“ oder „admin“ benötigt.');
        return;
      }
      onLogin(value, me);
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
        setError('Token ungültig. Bitte prüfen und erneut versuchen.');
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="login">
      <form className="login-card" onSubmit={submit}>
        <div className="brand">
          <Logo size={32} />
          OpenRelay
        </div>
        <div className="stack-sm">
          <h1>Anmelden</h1>
          <p className="muted">Melde dich mit dem Admin-Token oder einem API-Key (Scope „read“ oder „admin“) an.</p>
        </div>
        {expired ? (
          <div className="alert-box tone-warning compact" role="status">
            <Icon name="info" size={16} />
            <div className="alert-body">Die Sitzung ist abgelaufen oder das Token wurde widerrufen.</div>
          </div>
        ) : null}
        <div className="field">
          <label className="field-label" htmlFor="login-token">
            Token
          </label>
          <div className="input-group">
            <input
              id="login-token"
              className="input mono"
              type={show ? 'text' : 'password'}
              autoComplete="current-password"
              autoFocus
              spellCheck={false}
              placeholder="or_…"
              value={token}
              onChange={(e) => setToken(e.target.value)}
            />
            <button
              type="button"
              className="btn"
              onClick={() => setShow((s) => !s)}
              aria-label={show ? 'Token verbergen' : 'Token anzeigen'}
              title={show ? 'Token verbergen' : 'Token anzeigen'}
            >
              <Icon name={show ? 'eyeOff' : 'eye'} size={15} />
            </button>
          </div>
        </div>
        <FormError error={error} />
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? 'Prüfe…' : 'Anmelden'}
        </button>
        <div className="hint">
          <Icon name="key" size={16} />
          <div>
            Das Admin-Token stammt aus der Umgebungsvariable <code>OPENRELAY_ADMIN_TOKEN</code>. Ist sie nicht gesetzt, erzeugt
            der Server beim ersten Start ein Token und gibt es im Server-Log aus.
          </div>
        </div>
      </form>
    </main>
  );
}
