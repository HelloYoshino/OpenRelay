import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { Icon } from './Icon';

type ToastTone = 'ok' | 'error' | 'info';

interface ToastItem {
  id: number;
  tone: ToastTone;
  message: string;
}

interface ToastApi {
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => setItems((list) => list.filter((t) => t.id !== id)), []);

  const push = useCallback(
    (tone: ToastTone, message: string) => {
      const id = nextId.current++;
      setItems((list) => [...list.slice(-3), { id, tone, message }]);
      setTimeout(() => dismiss(id), tone === 'error' ? 7000 : 3500);
    },
    [dismiss],
  );

  const api = useMemo<ToastApi>(
    () => ({
      success: (m) => push('ok', m),
      error: (m) => push('error', m),
      info: (m) => push('info', m),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toasts" aria-live="polite" aria-atomic="false">
        {items.map((t) => (
          <div key={t.id} className={`toast toast-${t.tone}`} role={t.tone === 'error' ? 'alert' : 'status'}>
            <Icon name={t.tone === 'ok' ? 'checkCircle' : t.tone === 'error' ? 'alert' : 'info'} size={16} />
            <span>{t.message}</span>
            <button type="button" className="btn btn-icon btn-ghost" onClick={() => dismiss(t.id)} aria-label="Meldung schließen">
              <Icon name="x" size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}
