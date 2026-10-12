import { createContext, useContext, type ReactNode } from 'react';
import type { Me } from './apiTypes';

export interface Session {
  me: Me;
  token: string;
  /** Token has the `admin` scope (actions and configuration changes). */
  canWrite: boolean;
  logout: () => void;
}

const SessionContext = createContext<Session | null>(null);

export function SessionProvider({ value, children }: { value: Session; children: ReactNode }) {
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): Session {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside <SessionProvider>');
  return ctx;
}

export const NO_WRITE_TITLE = 'Erfordert ein Token mit Scope „admin“';
