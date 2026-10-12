import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { Alert, Incident } from '@openrelay/types';
import { API_BASE } from './api';
import type { DeliveryEvent } from './apiTypes';

/** Server-Sent Events from `/api/v1/stream`. */

export interface StreamEventMap {
  incident: Incident;
  alert: Alert;
  delivery: DeliveryEvent;
  /** Synthetic: the connection was re-established; data may have been missed. */
  reconnected: null;
}

export type StreamEventName = keyof StreamEventMap;
export type ConnectionState = 'connecting' | 'open' | 'closed';

type Listener<K extends StreamEventName> = (payload: StreamEventMap[K]) => void;
type AnyListener = (payload: unknown) => void;

class StreamHub {
  private listeners = new Map<StreamEventName, Set<AnyListener>>();

  on<K extends StreamEventName>(name: K, fn: Listener<K>): () => void {
    let set = this.listeners.get(name);
    if (!set) {
      set = new Set();
      this.listeners.set(name, set);
    }
    const wrapped = fn as AnyListener;
    set.add(wrapped);
    return () => set.delete(wrapped);
  }

  emit<K extends StreamEventName>(name: K, payload: StreamEventMap[K]): void {
    this.listeners.get(name)?.forEach((fn) => {
      try {
        fn(payload);
      } catch (err) {
        console.error('[stream] listener failed', err);
      }
    });
  }
}

interface StreamContextValue {
  hub: StreamHub;
  state: ConnectionState;
}

const StreamContext = createContext<StreamContextValue | null>(null);

const EVENTS: Exclude<StreamEventName, 'reconnected'>[] = ['incident', 'alert', 'delivery'];

export function StreamProvider({ token, children }: { token: string; children: ReactNode }) {
  const hubRef = useRef<StreamHub>(null);
  if (!hubRef.current) hubRef.current = new StreamHub();
  const hub = hubRef.current;
  const [state, setState] = useState<ConnectionState>('connecting');

  useEffect(() => {
    let source: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;
    let everOpened = false;
    let disposed = false;

    const connect = () => {
      if (disposed) return;
      setState('connecting');
      const es = new EventSource(`${API_BASE}/stream?token=${encodeURIComponent(token)}`);
      source = es;

      es.onopen = () => {
        attempt = 0;
        setState('open');
        if (everOpened) hub.emit('reconnected', null);
        everOpened = true;
      };

      es.onerror = () => {
        if (disposed) return;
        // CONNECTING: the browser retries on its own. CLOSED: we have to reconnect.
        if (es.readyState === EventSource.CLOSED) {
          es.close();
          setState('closed');
          scheduleReconnect();
        } else {
          setState('connecting');
        }
      };

      for (const name of EVENTS) {
        es.addEventListener(name, (ev: MessageEvent<string>) => {
          try {
            hub.emit(name, JSON.parse(ev.data) as StreamEventMap[typeof name]);
          } catch (err) {
            console.warn('[stream] invalid payload', name, err);
          }
        });
      }
    };

    const scheduleReconnect = () => {
      if (retryTimer) clearTimeout(retryTimer);
      const delay = Math.min(30_000, 1000 * 2 ** attempt) + Math.random() * 500;
      attempt += 1;
      retryTimer = setTimeout(connect, delay);
    };

    const onOnline = () => {
      if (!source || source.readyState === EventSource.CLOSED) {
        attempt = 0;
        if (retryTimer) clearTimeout(retryTimer);
        connect();
      }
    };
    window.addEventListener('online', onOnline);

    connect();
    return () => {
      disposed = true;
      if (retryTimer) clearTimeout(retryTimer);
      window.removeEventListener('online', onOnline);
      source?.close();
    };
  }, [token, hub]);

  return <StreamContext.Provider value={{ hub, state }}>{children}</StreamContext.Provider>;
}

function useStreamContext(): StreamContextValue {
  const ctx = useContext(StreamContext);
  if (!ctx) throw new Error('useStream* must be used inside <StreamProvider>');
  return ctx;
}

export function useStreamState(): ConnectionState {
  return useStreamContext().state;
}

/** Subscribes to one SSE event type. The handler may change between renders. */
export function useStreamEvent<K extends StreamEventName>(name: K, handler: Listener<K>): void {
  const { hub } = useStreamContext();
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => hub.on(name, (payload) => ref.current(payload)), [hub, name]);
}
