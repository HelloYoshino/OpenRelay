/**
 * Public plugin API of OpenRelay.
 *
 * A plugin is an ES module in the plugin directory whose default export is either an `OpenRelayPlugin`
 * object or a factory `(api) => OpenRelayPlugin`. Plugins can contribute
 *   - channels   (deliver notifications somewhere),
 *   - adapters   (translate foreign webhook payloads into events),
 *   - processors (enrich, rewrite or drop events before they enter the pipeline).
 *
 *   import { definePlugin } from '@openrelay/server/plugin';
 *   export default definePlugin({ name: 'my-plugin', channels: [...] });
 */
import type { Logger } from '../logger.js';
import type { EventInput, NormalizedEvent, NotificationMessage } from '../types.js';

export type { EventInput, NormalizedEvent, NotificationMessage, Logger };

export interface ConfigField {
  key: string;
  label: string;
  type: 'string' | 'secret' | 'number' | 'boolean' | 'select' | 'text';
  required?: boolean;
  placeholder?: string;
  help?: string;
  options?: Array<{ value: string; label: string }>;
  default?: string | number | boolean;
}

export interface ChannelContext {
  logger: Logger;
  /** Aborted when the delivery times out or the server shuts down. */
  signal: AbortSignal;
  publicUrl: string;
}

export interface ChannelPlugin<C = Record<string, unknown>> {
  /** Unique type id, e.g. "discord". */
  type: string;
  displayName: string;
  description?: string;
  configSchema: ConfigField[];
  /** Returns human readable problems with the configuration. */
  validate?(config: C): string[] | void;
  /** Throw a `DeliveryError` to control retries; any other error is treated as retryable. */
  send(message: NotificationMessage, config: C, ctx: ChannelContext): Promise<void>;
}

export interface AdapterRequest {
  body: unknown;
  rawBody: Buffer | null;
  headers: Record<string, string | undefined>;
  query: Record<string, string | undefined>;
}

export interface AdapterContext {
  logger: Logger;
  /** Reads an environment variable (e.g. a webhook secret). */
  env(name: string): string | undefined;
}

export interface IngestAdapter {
  name: string;
  description?: string;
  /** Returns the events contained in the request. Throw `AdapterError` for invalid requests. */
  parse(req: AdapterRequest, ctx: AdapterContext): EventInput[] | Promise<EventInput[]>;
}

export interface ProcessorContext {
  logger: Logger;
}

export interface EventProcessor {
  name: string;
  /** Return the (possibly modified) event, or `null` to drop it. */
  process(event: NormalizedEvent, ctx: ProcessorContext): NormalizedEvent | null | Promise<NormalizedEvent | null>;
}

export interface OpenRelayPlugin {
  name: string;
  version?: string;
  channels?: ChannelPlugin<any>[];
  adapters?: IngestAdapter[];
  processors?: EventProcessor[];
}

export interface PluginApi {
  logger: Logger;
  publicUrl: string;
  version: string;
  /** Helpers, so plugins in the plugin directory need no `import` of OpenRelay. */
  DeliveryError: typeof DeliveryError;
  AdapterError: typeof AdapterError;
  httpRequest: typeof httpRequest;
}

export type PluginFactory = (api: PluginApi) => OpenRelayPlugin | Promise<OpenRelayPlugin>;

export function definePlugin<T extends OpenRelayPlugin | PluginFactory>(plugin: T): T {
  return plugin;
}

export function defineChannel<C = Record<string, unknown>>(channel: ChannelPlugin<C>): ChannelPlugin<C> {
  return channel;
}

/** Error thrown by channels to control the retry behaviour of the delivery queue. */
export class DeliveryError extends Error {
  constructor(
    message: string,
    readonly retryable = true,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'DeliveryError';
  }
}

/** Error thrown by adapters for malformed input (answered with HTTP 400). */
export class AdapterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AdapterError';
  }
}

export interface HttpOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  signal?: AbortSignal;
}

/**
 * fetch() wrapper for channels: sends JSON (or a string body), maps HTTP errors onto `DeliveryError`
 * (429/5xx/network → retryable, honouring Retry-After; other 4xx → permanent).
 */
export async function httpRequest(url: string, opts: HttpOptions = {}): Promise<Response> {
  const headers: Record<string, string> = { 'user-agent': 'OpenRelay', ...opts.headers };
  let body: string | undefined;
  if (opts.body !== undefined) {
    if (typeof opts.body === 'string') {
      body = opts.body;
    } else {
      body = JSON.stringify(opts.body);
      if (!Object.keys(headers).some((h) => h.toLowerCase() === 'content-type')) headers['content-type'] = 'application/json';
    }
  }
  let res: Response;
  try {
    res = await fetch(url, { method: opts.method ?? (body ? 'POST' : 'GET'), headers, body, signal: opts.signal });
  } catch (err) {
    const cause = (err as Error & { cause?: { code?: string } }).cause?.code;
    throw new DeliveryError(`Netzwerkfehler: ${(err as Error).message}${cause ? ` (${cause})` : ''}`, true);
  }
  if (res.ok) return res;

  const text = (await res.text().catch(() => '')).slice(0, 300);
  const retryAfterHeader = res.headers.get('retry-after');
  let retryAfterMs: number | undefined;
  if (retryAfterHeader) {
    const seconds = Number(retryAfterHeader);
    retryAfterMs = Number.isFinite(seconds) ? seconds * 1000 : Math.max(0, Date.parse(retryAfterHeader) - Date.now());
  }
  if (!retryAfterMs && res.status === 429) {
    // Discord & Telegram report the wait time in the body.
    const parsed = (() => {
      try {
        return JSON.parse(text) as { retry_after?: number; parameters?: { retry_after?: number } };
      } catch {
        return null;
      }
    })();
    const seconds = parsed?.retry_after ?? parsed?.parameters?.retry_after;
    if (typeof seconds === 'number') retryAfterMs = seconds * 1000;
  }
  const retryable = res.status === 429 || res.status === 408 || res.status >= 500;
  throw new DeliveryError(`HTTP ${res.status}${text ? `: ${text}` : ''}`, retryable, retryAfterMs);
}
