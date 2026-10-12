import type { Channel, Delivery, NotificationMessage } from '../types.js';
import { MINUTE, SECOND } from '../util/time.js';
import type { EngineContext } from './context.js';

export interface DeliveryOptions {
  /** Timeout of a single send attempt. */
  timeoutMs: number;
  maxAttempts: number;
  /** Give up on deliveries older than this. */
  maxAgeMs: number;
}

export const DEFAULT_DELIVERY_OPTIONS: DeliveryOptions = {
  timeoutMs: 15 * SECOND,
  maxAttempts: 15,
  maxAgeMs: 24 * 60 * MINUTE,
};

interface ErrorInfo {
  message: string;
  retryable: boolean;
  retryAfterMs?: number;
}

function describe(err: unknown): ErrorInfo {
  const e = err as { name?: string; message?: string; retryable?: boolean; retryAfterMs?: number };
  // Duck typing: external plugins may bundle their own copy of DeliveryError.
  if (e && e.name === 'DeliveryError') {
    return { message: e.message ?? 'Fehler', retryable: e.retryable !== false, retryAfterMs: e.retryAfterMs };
  }
  if (e && (e.name === 'AbortError' || e.name === 'TimeoutError')) return { message: 'Zeitüberschreitung', retryable: true };
  return { message: e?.message ?? String(err), retryable: true };
}

/** Exponential backoff with jitter: 5 s, 10 s, 20 s … capped at 30 min. */
export function backoff(attempt: number, random = Math.random): number {
  const base = Math.min(30 * MINUTE, 5 * SECOND * 2 ** Math.max(0, attempt - 1));
  return Math.round(base * (0.8 + random() * 0.4));
}

/**
 * Persistent outbox ("offline queue"). Deliveries survive restarts and network outages and are retried with
 * backoff; per channel they are sent strictly in order (FIFO) with a circuit breaker for failing channels.
 */
export class DeliveryWorker {
  private readonly inflight = new Map<string, AbortController>();
  private timer: NodeJS.Timeout | null = null;
  private scheduled = false;
  private running: Promise<void> | null = null;
  private stopped = false;

  constructor(
    private readonly ctx: EngineContext,
    private readonly options: DeliveryOptions = DEFAULT_DELIVERY_OPTIONS,
  ) {}

  start(intervalMs = 1000): void {
    this.stopped = false;
    const reset = this.ctx.store.resetSendingDeliveries(this.ctx.clock.now());
    if (reset > 0) this.ctx.logger.info(`${reset} unterbrochene Zustellung(en) werden erneut versucht`);
    this.timer = setInterval(() => void this.process(), intervalMs);
    this.timer.unref?.();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const controller of this.inflight.values()) controller.abort();
    await this.running;
  }

  wake(): void {
    if (this.scheduled || this.stopped || !this.timer) return;
    this.scheduled = true;
    setImmediate(() => {
      this.scheduled = false;
      void this.process();
    });
  }

  /** Sends all due queue heads. Resolves once the started sends finished. */
  async process(): Promise<void> {
    const now = this.ctx.clock.now();
    const tasks: Promise<void>[] = [];
    for (const delivery of this.ctx.store.queueHeads()) {
      if (this.inflight.has(delivery.channelId)) continue;
      if (delivery.status !== 'pending' || delivery.nextAttemptAt > now) continue;
      tasks.push(this.send(delivery));
    }
    if (tasks.length === 0) return;
    const run = Promise.all(tasks).then(() => undefined);
    this.running = run;
    await run;
    // Channels whose head was just sent may have more due items.
    if (!this.stopped && tasks.length > 0) {
      const more = this.ctx.store.queueHeads().some((d) => d.status === 'pending' && d.nextAttemptAt <= this.ctx.clock.now() && !this.inflight.has(d.channelId));
      if (more) await this.process();
    }
  }

  private emit(d: Delivery, status: Delivery['status']): void {
    this.ctx.bus.emit('delivery', { id: d.id, status, channelId: d.channelId, incidentId: d.incidentId, kind: d.kind });
  }

  private async send(delivery: Delivery): Promise<void> {
    const now = this.ctx.clock.now();
    const channel = this.ctx.store.getChannel(delivery.channelId);
    if (!channel) {
      this.ctx.store.markDeliveryFailed(delivery.id, now, 'Kanal wurde gelöscht', false);
      return this.emit(delivery, 'failed');
    }
    if (!channel.enabled) {
      this.ctx.store.markDeliveryFailed(delivery.id, now, 'Kanal ist deaktiviert', false);
      return this.emit(delivery, 'failed');
    }
    if (channel.circuitOpenUntil && channel.circuitOpenUntil > now) {
      this.ctx.store.postponeDelivery(delivery.id, now, channel.circuitOpenUntil);
      return;
    }
    const plugin = this.ctx.registry.channel(channel.type);
    if (!plugin) {
      this.ctx.store.markDeliveryFailed(delivery.id, now, `Unbekannter Kanaltyp "${channel.type}" (Plugin fehlt?)`, false);
      return this.emit(delivery, 'failed');
    }

    const controller = new AbortController();
    this.inflight.set(channel.id, controller);
    this.ctx.store.markDeliverySending(delivery.id, now);
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs);
    try {
      await plugin.send(delivery.message, channel.config, { logger: this.ctx.logger, signal: controller.signal, publicUrl: this.ctx.publicUrl });
      const done = this.ctx.clock.now();
      this.ctx.store.markDeliverySent(delivery.id, done);
      this.ctx.store.recordChannelSuccess(channel.id, done);
      this.emit(delivery, 'sent');
    } catch (err) {
      this.handleFailure(delivery, channel, describe(err));
    } finally {
      clearTimeout(timeout);
      this.inflight.delete(channel.id);
    }
  }

  private handleFailure(delivery: Delivery, channel: Channel, info: ErrorInfo): void {
    const now = this.ctx.clock.now();
    const attempts = delivery.attempts + 1;
    const age = now - delivery.createdAt;
    const failures = channel.consecutiveFailures + 1;
    // Circuit breaker: after 5 consecutive failures pause the channel (30 s, 60 s, … up to 15 min).
    const circuit = failures >= 5 ? now + Math.min(15 * MINUTE, 30 * SECOND * 2 ** (failures - 5)) : null;
    this.ctx.store.recordChannelFailure(channel.id, now, info.message, circuit);

    if (info.retryable && attempts < this.options.maxAttempts && age < this.options.maxAgeMs && !this.stopped) {
      const delay = Math.max(info.retryAfterMs ?? 0, backoff(attempts));
      this.ctx.store.markDeliveryRetry(delivery.id, now, now + delay, info.message);
      this.ctx.logger.warn({ channel: channel.name, attempt: attempts, retryInMs: delay, error: info.message }, 'Zustellung fehlgeschlagen, neuer Versuch geplant');
      this.emit(delivery, 'pending');
    } else if (this.stopped && info.retryable) {
      this.ctx.store.postponeDelivery(delivery.id, now, now);
    } else {
      this.ctx.store.markDeliveryFailed(delivery.id, now, info.message);
      this.ctx.logger.error({ channel: channel.name, attempts, error: info.message }, 'Zustellung endgültig fehlgeschlagen');
      this.emit(delivery, 'failed');
    }
  }

  /** Sends a message directly, bypassing the queue (used for "send test"). */
  async sendNow(channel: Channel, message: NotificationMessage): Promise<void> {
    const plugin = this.ctx.registry.channel(channel.type);
    if (!plugin) throw new Error(`Unbekannter Kanaltyp "${channel.type}"`);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs);
    try {
      await plugin.send(message, channel.config, { logger: this.ctx.logger, signal: controller.signal, publicUrl: this.ctx.publicUrl });
      this.ctx.store.recordChannelSuccess(channel.id, this.ctx.clock.now());
    } catch (err) {
      const info = describe(err);
      this.ctx.store.recordChannelFailure(channel.id, this.ctx.clock.now(), info.message, null);
      throw new Error(info.message);
    } finally {
      clearTimeout(timeout);
    }
  }
}
