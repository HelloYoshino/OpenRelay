import { useEffect, useMemo, useSyncExternalStore } from 'react';
import type { Channel, EscalationPolicy } from '@openrelay/types';
import { api } from './api';
import type { ListResponse } from './apiTypes';

/**
 * Small shared cache for reference data used across pages (channel names, policies).
 * Pages that edit the data call `invalidate()` after saving.
 */
function createListCache<T>(path: string, ttlMs = 60_000) {
  let items: T[] | undefined;
  let fetchedAt = 0;
  let inflight: Promise<void> | null = null;
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((l) => l());

  const load = (force = false): Promise<void> => {
    if (inflight) return inflight;
    if (!force && items && Date.now() - fetchedAt < ttlMs) return Promise.resolve();
    inflight = api
      .get<ListResponse<T>>(path)
      .then((res) => {
        items = res.items ?? [];
        fetchedAt = Date.now();
        notify();
      })
      .catch(() => {
        /* reference data is optional; pages show ids instead */
      })
      .finally(() => {
        inflight = null;
      });
    return inflight;
  };

  const subscribe = (cb: () => void) => {
    listeners.add(cb);
    return () => listeners.delete(cb);
  };

  return {
    use(): T[] | undefined {
      const snapshot = useSyncExternalStore(subscribe, () => items);
      useEffect(() => {
        void load();
      }, []);
      return snapshot;
    },
    set(next: T[]) {
      items = next;
      fetchedAt = Date.now();
      notify();
    },
    invalidate() {
      void load(true);
    },
    clear() {
      items = undefined;
      fetchedAt = 0;
    },
  };
}

export const channelCache = createListCache<Channel>('/channels');
export const policyCache = createListCache<EscalationPolicy>('/escalation-policies');

export function useChannelMap(): Map<string, Channel> {
  const channels = channelCache.use();
  return useMemo(() => new Map((channels ?? []).map((c) => [c.id, c])), [channels]);
}

export function clearCaches(): void {
  channelCache.clear();
  policyCache.clear();
}
