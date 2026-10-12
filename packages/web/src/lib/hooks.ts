import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { api, isAbort, type Query } from './api';

export interface ApiState<T> {
  data: T | undefined;
  error: Error | null;
  /** True while the first request (or a request after a key change) is running. */
  loading: boolean;
  /** True during any request, including silent reloads. */
  refreshing: boolean;
  /** Data of a previous key is shown while the current key loads (`keepPrevious`). */
  stale: boolean;
  reload: () => Promise<void>;
  setData: (update: T | ((prev: T | undefined) => T | undefined)) => void;
}

/**
 * Fetches `path` (with `query`) and refetches when either changes.
 * `reload()` refreshes silently — the previous data stays visible.
 * Pass `null` as path to skip fetching. With `keepPrevious`, data of the previous
 * key stays visible while the new key loads (filters, pagination).
 */
export function useApi<T>(path: string | null, query?: Query, opts: { keepPrevious?: boolean } = {}): ApiState<T> {
  const key = path === null ? null : path + JSON.stringify(query ?? {});
  const [state, setState] = useState<{ key: string | null; data: T | undefined; error: Error | null }>({
    key: null,
    data: undefined,
    error: null,
  });
  const [refreshing, setRefreshing] = useState(false);
  const seq = useRef(0);
  const argsRef = useRef({ path, query });
  argsRef.current = { path, query };

  const run = useCallback(async (signal?: AbortSignal) => {
    const { path: p, query: q } = argsRef.current;
    if (p === null) return;
    const id = ++seq.current;
    const runKey = p + JSON.stringify(q ?? {});
    setRefreshing(true);
    try {
      const data = await api.get<T>(p, q, signal);
      if (id === seq.current) setState({ key: runKey, data, error: null });
    } catch (err) {
      if (isAbort(err)) return;
      if (id === seq.current) {
        setState((prev) => ({
          key: runKey,
          data: prev.key === runKey ? prev.data : undefined,
          error: err instanceof Error ? err : new Error(String(err)),
        }));
      }
    } finally {
      if (id === seq.current) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (key === null) return;
    const ctrl = new AbortController();
    void run(ctrl.signal);
    return () => ctrl.abort();
  }, [key, run]);

  const reload = useCallback(() => run(), [run]);
  const setData = useCallback((update: T | ((prev: T | undefined) => T | undefined)) => {
    setState((prev) => ({
      ...prev,
      data: typeof update === 'function' ? (update as (p: T | undefined) => T | undefined)(prev.data) : update,
    }));
  }, []);

  const current = state.key === key;
  const keep = !!opts.keepPrevious && state.data !== undefined;
  return {
    data: current || keep ? state.data : undefined,
    error: current ? state.error : null,
    loading: key !== null && !current && !keep,
    refreshing,
    stale: !current && keep,
    reload,
    setData,
  };
}

/** Calls `fn` every `ms` milliseconds (latest closure, no restarts on re-render). */
export function useInterval(fn: () => void, ms: number | null): void {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (ms === null) return;
    const id = window.setInterval(() => ref.current(), ms);
    return () => window.clearInterval(id);
  }, [ms]);
}

/**
 * Returns a stable function that runs `fn` once `ms` after the last call — but at the latest
 * `maxWait` after the first pending call, so a constant stream of events still triggers updates.
 */
export function useDebouncedCallback<A extends unknown[]>(
  fn: (...args: A) => void,
  ms: number,
  maxWait: number = ms * 4,
): (...args: A) => void {
  const ref = useRef(fn);
  ref.current = fn;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firstCall = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  return useCallback(
    (...args: A) => {
      const now = Date.now();
      if (firstCall.current === null) firstCall.current = now;
      if (timer.current) clearTimeout(timer.current);
      const wait = Math.max(0, Math.min(ms, firstCall.current + maxWait - now));
      timer.current = setTimeout(() => {
        timer.current = null;
        firstCall.current = null;
        ref.current(...args);
      }, wait);
    },
    [ms, maxWait],
  );
}

/** Debounced copy of a value. */
export function useDebouncedValue<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

// Shared ticker so every relative timestamp re-renders together.
let now = Date.now();
const tickListeners = new Set<() => void>();
let tickTimer: ReturnType<typeof setInterval> | null = null;

function subscribeTick(cb: () => void): () => void {
  tickListeners.add(cb);
  if (!tickTimer) {
    tickTimer = setInterval(() => {
      now = Date.now();
      tickListeners.forEach((l) => l());
    }, 20_000);
  }
  return () => {
    tickListeners.delete(cb);
    if (tickListeners.size === 0 && tickTimer) {
      clearInterval(tickTimer);
      tickTimer = null;
    }
  };
}

export function useNow(): number {
  return useSyncExternalStore(
    subscribeTick,
    () => now,
    () => now,
  );
}

export function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeStorage(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

export type ActionResult<R> = { ok: true; value: R } | { ok: false; error: string };

/** Runs an async action while tracking a busy flag and the error message. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const run = useCallback(async <R>(fn: () => Promise<R>): Promise<ActionResult<R>> => {
    setBusy(true);
    setError(null);
    try {
      const value = await fn();
      return { ok: true, value };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (mounted.current) setError(message);
      return { ok: false, error: message };
    } finally {
      if (mounted.current) setBusy(false);
    }
  }, []);
  return { busy, error, setError, run };
}
