/**
 * OpenRelay client.
 *
 *   const relay = new OpenRelayClient({ url: 'http://relay:8080', token: process.env.OPENRELAY_TOKEN!, source: 'delta-ai' });
 *   await relay.critical('Datenbank nicht erreichbar', { service: 'api', message: err.message });
 *
 * Events that can't be delivered (network error, 5xx, 429) are kept in an offline queue and retried with
 * exponential backoff. With `queue.persistPath` the queue survives restarts (Node.js only).
 */

export type Severity = 'debug' | 'info' | 'warning' | 'high' | 'critical';

export interface RelayEvent {
  title: string;
  source?: string;
  message?: string;
  severity?: Severity;
  status?: 'firing' | 'resolved';
  type?: string;
  service?: string;
  host?: string;
  fingerprint?: string;
  correlationKey?: string;
  labels?: Record<string, string>;
  url?: string;
  timestamp?: string | number;
  ttl?: number;
  payload?: unknown;
}

export interface IngestResult {
  eventId: string | null;
  alertId: string | null;
  incidentId: string | null;
  action: 'created' | 'deduplicated' | 'reopened' | 'resolved' | 'ignored' | 'dropped';
}

export type SendResult = { status: 'sent'; results: IngestResult[] } | { status: 'queued'; reason: string };

export interface QueueOptions {
  /** Maximum queued events; the oldest are dropped beyond. Default 1000. */
  maxSize?: number;
  /** JSON file used to persist the queue (Node.js). */
  persistPath?: string;
  retryBaseMs?: number;
  retryMaxMs?: number;
}

export interface ClientOptions {
  url: string;
  token: string;
  /** Default `source` for events without one. */
  source?: string;
  timeoutMs?: number;
  /** `false` disables queuing: failures reject instead. */
  queue?: QueueOptions | false;
  fetch?: typeof fetch;
  onError?: (error: Error) => void;
}

/** Non-retryable API error (4xx), e.g. invalid token or validation failure. */
export class OpenRelayError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'OpenRelayError';
  }
}

class RetryableError extends Error {}

interface Persistence {
  load(): RelayEvent[];
  save(events: RelayEvent[]): void;
}

async function filePersistence(path: string): Promise<Persistence> {
  const fs = await import('node:fs');
  const { dirname } = await import('node:path');
  return {
    load() {
      try {
        const data = JSON.parse(fs.readFileSync(path, 'utf8')) as unknown;
        return Array.isArray(data) ? (data as RelayEvent[]) : [];
      } catch {
        return [];
      }
    },
    save(events) {
      try {
        fs.mkdirSync(dirname(path), { recursive: true });
        const tmp = `${path}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(events));
        fs.renameSync(tmp, path);
      } catch {
        /* best effort */
      }
    },
  };
}

export class OpenRelayClient {
  private readonly base: string;
  private readonly fetchImpl: typeof fetch;
  private readonly queueOpts: Required<Omit<QueueOptions, 'persistPath'>> & { persistPath?: string };
  private readonly queueEnabled: boolean;
  private queue: RelayEvent[] = [];
  private attempt = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private flushing: Promise<number> | null = null;
  private persistence: Persistence | null = null;
  private ready: Promise<void>;
  /** Number of events dropped because the queue was full. */
  dropped = 0;

  constructor(private readonly options: ClientOptions) {
    if (!options.url) throw new Error('OpenRelayClient: url fehlt');
    if (!options.token) throw new Error('OpenRelayClient: token fehlt');
    this.base = options.url.replace(/\/+$/, '');
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.queueEnabled = options.queue !== false;
    const q = options.queue || {};
    this.queueOpts = {
      maxSize: q.maxSize ?? 1000,
      retryBaseMs: q.retryBaseMs ?? 1000,
      retryMaxMs: q.retryMaxMs ?? 60_000,
      persistPath: q.persistPath,
    };
    this.ready = this.queueOpts.persistPath
      ? filePersistence(this.queueOpts.persistPath).then((p) => {
          this.persistence = p;
          this.queue = [...p.load(), ...this.queue];
          if (this.queue.length > 0) this.schedule(0);
        })
      : Promise.resolve();
  }

  /** Events waiting in the offline queue. */
  get pending(): number {
    return this.queue.length;
  }

  private withDefaults(event: RelayEvent): RelayEvent {
    return { ...event, source: event.source ?? this.options.source, timestamp: event.timestamp ?? Date.now() };
  }

  private async post(events: RelayEvent[]): Promise<IngestResult[]> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 5000);
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.base}/api/v1/events`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.options.token}` },
        body: JSON.stringify(events),
        signal: controller.signal,
      });
    } catch (err) {
      throw new RetryableError(`OpenRelay nicht erreichbar: ${(err as Error).message}`);
    } finally {
      clearTimeout(timeout);
    }
    if (res.status === 429 || res.status >= 500) throw new RetryableError(`OpenRelay antwortet mit HTTP ${res.status}`);
    const body = (await res.json().catch(() => ({}))) as { results?: IngestResult[]; error?: string };
    if (!res.ok) throw new OpenRelayError(body.error ?? `HTTP ${res.status}`, res.status);
    return body.results ?? [];
  }

  private enqueue(events: RelayEvent[]): void {
    this.queue.push(...events);
    const overflow = this.queue.length - this.queueOpts.maxSize;
    if (overflow > 0) {
      this.queue.splice(0, overflow);
      this.dropped += overflow;
    }
    this.persistence?.save(this.queue);
    this.schedule();
  }

  private schedule(delay?: number): void {
    if (this.timer || this.queue.length === 0) return;
    const ms = delay ?? Math.min(this.queueOpts.retryMaxMs, this.queueOpts.retryBaseMs * 2 ** this.attempt);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, ms);
    (this.timer as { unref?: () => void }).unref?.();
  }

  /** Sends one or more events. Resolves with `queued` when OpenRelay is unreachable (unless queuing is disabled). */
  async send(event: RelayEvent | RelayEvent[]): Promise<SendResult> {
    await this.ready;
    const events = (Array.isArray(event) ? event : [event]).map((e) => this.withDefaults(e));
    // Preserve order: while older events wait, new ones queue behind them.
    if (this.queueEnabled && this.queue.length > 0) {
      this.enqueue(events);
      void this.flush();
      return { status: 'queued', reason: 'Warteschlange wird abgearbeitet' };
    }
    try {
      return { status: 'sent', results: await this.post(events) };
    } catch (err) {
      if (err instanceof RetryableError && this.queueEnabled) {
        this.options.onError?.(err);
        this.enqueue(events);
        return { status: 'queued', reason: err.message };
      }
      throw err;
    }
  }

  /** Tries to deliver queued events now. Returns the number still pending. */
  flush(): Promise<number> {
    if (this.flushing) return this.flushing;
    this.flushing = (async () => {
      await this.ready;
      if (this.timer) {
        clearTimeout(this.timer);
        this.timer = null;
      }
      while (this.queue.length > 0) {
        const batch = this.queue.slice(0, 100);
        try {
          await this.post(batch);
          this.queue.splice(0, batch.length);
          this.attempt = 0;
          this.persistence?.save(this.queue);
        } catch (err) {
          if (err instanceof OpenRelayError) {
            // The server rejected the batch – retrying won't help.
            this.queue.splice(0, batch.length);
            this.persistence?.save(this.queue);
            this.options.onError?.(err);
            continue;
          }
          this.attempt++;
          this.options.onError?.(err as Error);
          this.schedule();
          break;
        }
      }
      return this.queue.length;
    })().finally(() => {
      this.flushing = null;
    });
    return this.flushing;
  }

  critical(title: string, extra: Omit<RelayEvent, 'title' | 'severity'> = {}): Promise<SendResult> {
    return this.send({ ...extra, title, severity: 'critical' });
  }

  high(title: string, extra: Omit<RelayEvent, 'title' | 'severity'> = {}): Promise<SendResult> {
    return this.send({ ...extra, title, severity: 'high' });
  }

  warning(title: string, extra: Omit<RelayEvent, 'title' | 'severity'> = {}): Promise<SendResult> {
    return this.send({ ...extra, title, severity: 'warning' });
  }

  info(title: string, extra: Omit<RelayEvent, 'title' | 'severity'> = {}): Promise<SendResult> {
    return this.send({ ...extra, title, severity: 'info' });
  }

  /** Resolves an alert. Pass the same title/service (or fingerprint) as the firing event. */
  resolve(event: string | Omit<RelayEvent, 'status'>): Promise<SendResult> {
    const e = typeof event === 'string' ? { title: event } : event;
    return this.send({ ...e, status: 'resolved' });
  }

  /** Flushes the queue (bounded by `timeoutMs`) and stops retry timers. */
  async close(timeoutMs = 5000): Promise<number> {
    const remaining = await Promise.race([
      this.flush(),
      new Promise<number>((resolve) => setTimeout(() => resolve(this.queue.length), timeoutMs)),
    ]);
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    return remaining;
  }
}
