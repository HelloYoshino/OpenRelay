import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiError, api, clearToken, errorText, getToken, onUnauthorized, setToken } from './lib/api';
import type { Me } from './lib/apiTypes';
import { clearCaches } from './lib/cache';
import { SessionProvider, type Session } from './lib/session';
import { StreamProvider } from './lib/stream';
import { ToastProvider } from './components/Toast';
import { Layout } from './components/Layout';
import { Logo } from './components/Logo';
import { Spinner } from './components/ui';
import { Icon } from './components/Icon';
import { LoginPage } from './pages/LoginPage';

export function App() {
  return (
    <ToastProvider>
      <Root />
    </ToastProvider>
  );
}

function Root() {
  const [token, setTokenState] = useState<string | null>(() => getToken());
  const [me, setMe] = useState<Me | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const [attempt, setAttempt] = useState(0);

  const resetSession = useCallback(() => {
    setTokenState(null);
    setMe(null);
    setBootError(null);
    clearCaches();
  }, []);

  useEffect(() => {
    onUnauthorized(() => {
      resetSession();
      setExpired(true);
    });
    return () => onUnauthorized(null);
  }, [resetSession]);

  useEffect(() => {
    if (!token || me) return;
    let cancelled = false;
    setBootError(null);
    api
      .get<Me>('/me')
      .then((res) => {
        if (!cancelled) setMe(res);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 401) return; // handled by onUnauthorized
        setBootError(errorText(err));
      });
    return () => {
      cancelled = true;
    };
  }, [token, me, attempt]);

  const logout = useCallback(() => {
    clearToken();
    setExpired(false);
    resetSession();
  }, [resetSession]);

  const session = useMemo<Session | null>(
    () =>
      token && me
        ? {
            token,
            me,
            canWrite: me.scopes.includes('admin'),
            logout,
          }
        : null,
    [token, me, logout],
  );

  if (!token) {
    return (
      <LoginPage
        expired={expired}
        onLogin={(newToken, info) => {
          setToken(newToken);
          setExpired(false);
          setMe(info);
          setTokenState(newToken);
        }}
      />
    );
  }

  if (!session) {
    return (
      <div className="splash">
        <Logo size={40} />
        {bootError ? (
          <>
            <div className="alert-box tone-critical" role="alert" style={{ maxWidth: 440 }}>
              <Icon name="alert" size={16} />
              <div className="alert-body">
                <strong>Verbindung fehlgeschlagen</strong>
                <span>{bootError}</span>
              </div>
            </div>
            <div className="row">
              <button type="button" className="btn btn-primary" onClick={() => setAttempt((a) => a + 1)}>
                <Icon name="refresh" size={14} /> Erneut versuchen
              </button>
              <button type="button" className="btn" onClick={logout}>
                Abmelden
              </button>
            </div>
          </>
        ) : (
          <Spinner label="Verbinde mit OpenRelay…" />
        )}
      </div>
    );
  }

  return (
    <SessionProvider value={session}>
      <StreamProvider token={session.token}>
        <Layout />
      </StreamProvider>
    </SessionProvider>
  );
}
