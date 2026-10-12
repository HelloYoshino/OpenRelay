import { useSyncExternalStore } from 'react';

/** Minimal hash router: `#/incidents/inc_123?status=open`. */

export interface Route {
  /** Path without query, always starting with "/". */
  path: string;
  segments: string[];
  query: URLSearchParams;
}

function readHash(): string {
  const raw = window.location.hash.replace(/^#/, '');
  return raw.startsWith('/') ? raw : `/${raw}`;
}

function subscribe(cb: () => void): () => void {
  window.addEventListener('hashchange', cb);
  return () => window.removeEventListener('hashchange', cb);
}

let cachedHash = '';
let cachedRoute: Route = parse('/');

function parse(hash: string): Route {
  const [pathPart = '/', queryPart = ''] = hash.split('?', 2);
  const segments = pathPart
    .split('/')
    .filter(Boolean)
    .map((s) => {
      try {
        return decodeURIComponent(s);
      } catch {
        return s;
      }
    });
  return { path: `/${segments.join('/')}`, segments, query: new URLSearchParams(queryPart) };
}

function snapshot(): Route {
  const hash = readHash();
  if (hash !== cachedHash) {
    cachedHash = hash;
    cachedRoute = parse(hash);
  }
  return cachedRoute;
}

export function useRoute(): Route {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

export function href(path: string, query?: Record<string, string | number | undefined | null>): string {
  let target = path.startsWith('/') ? path : `/${path}`;
  if (query) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== '') params.set(k, String(v));
    }
    const qs = params.toString();
    if (qs) target += `?${qs}`;
  }
  return `#${target}`;
}

export function navigate(
  path: string,
  opts: { replace?: boolean; query?: Record<string, string | number | undefined | null> } = {},
): void {
  const target = href(path, opts.query);
  if (opts.replace) {
    const url = new URL(window.location.href);
    url.hash = target;
    window.history.replaceState(window.history.state, '', url);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } else {
    window.location.hash = target;
  }
}

export function incidentHref(id: string): string {
  return href(`/incidents/${encodeURIComponent(id)}`);
}
