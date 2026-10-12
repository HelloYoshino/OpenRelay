/** Thin fetch wrapper for the OpenRelay API (base `/api/v1`). */

export const API_BASE = '/api/v1';
const TOKEN_KEY = 'openrelay.token';

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* storage unavailable — token lives only for this request */
  }
}

export function clearToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

export class ApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

type UnauthorizedHandler = () => void;
let unauthorizedHandler: UnauthorizedHandler | null = null;

/** Registers the callback invoked after a 401 (token is already cleared). */
export function onUnauthorized(handler: UnauthorizedHandler | null): void {
  unauthorizedHandler = handler;
}

export type QueryValue = string | number | boolean | null | undefined;
export type Query = Record<string, QueryValue>;

export function buildQuery(query?: Query): string {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    params.set(key, String(value));
  }
  const s = params.toString();
  return s ? `?${s}` : '';
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  query?: Query;
  /** JSON-encoded unless `rawBody` is used. */
  body?: unknown;
  rawBody?: BodyInit;
  contentType?: string;
  signal?: AbortSignal;
  /** Use a token other than the stored one (login validation). */
  token?: string;
  /** Return the response text instead of parsed JSON. */
  asText?: boolean;
  accept?: string;
}

async function errorMessage(res: Response): Promise<string> {
  const text = await res.text().catch(() => '');
  if (text) {
    try {
      const parsed = JSON.parse(text) as { error?: unknown; message?: unknown };
      if (typeof parsed.error === 'string' && parsed.error) return parsed.error;
      if (typeof parsed.message === 'string' && parsed.message) return parsed.message;
    } catch {
      if (text.length < 300) return text;
    }
  }
  switch (res.status) {
    case 401:
      return 'Nicht angemeldet oder Token ungültig.';
    case 403:
      return 'Keine Berechtigung (Scope fehlt).';
    case 404:
      return 'Nicht gefunden.';
    case 502:
    case 503:
    case 504:
      return 'Server nicht erreichbar.';
    default:
      return `Anfrage fehlgeschlagen (HTTP ${res.status}).`;
  }
}

export async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: opts.accept ?? 'application/json' };
  const token = opts.token ?? getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  let body: BodyInit | undefined;
  if (opts.rawBody !== undefined) {
    body = opts.rawBody;
    if (opts.contentType) headers['Content-Type'] = opts.contentType;
  } else if (opts.body !== undefined) {
    body = JSON.stringify(opts.body);
    headers['Content-Type'] = 'application/json';
  }

  let res: Response;
  try {
    res = await fetch(API_BASE + path + buildQuery(opts.query), {
      method: opts.method ?? 'GET',
      headers,
      body,
      signal: opts.signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new ApiError('Server nicht erreichbar. Läuft OpenRelay?', 0);
  }

  if (!res.ok) {
    const message = await errorMessage(res);
    if (res.status === 401 && opts.token === undefined) {
      clearToken();
      unauthorizedHandler?.();
    }
    throw new ApiError(message, res.status);
  }

  if (opts.asText) return (await res.text()) as T;
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  if (!text) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return text as T;
  }
}

export const api = {
  get<T>(path: string, query?: Query, signal?: AbortSignal): Promise<T> {
    return request<T>(path, { query, signal });
  },
  post<T>(path: string, body?: unknown): Promise<T> {
    return request<T>(path, { method: 'POST', body: body ?? {} });
  },
  put<T>(path: string, body: unknown): Promise<T> {
    return request<T>(path, { method: 'PUT', body });
  },
  del<T = void>(path: string): Promise<T> {
    return request<T>(path, { method: 'DELETE' });
  },
};

export function errorText(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return 'Unbekannter Fehler';
}

export function isAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}
