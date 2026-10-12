import { randomBytes } from 'node:crypto';
import { systemClock, type Clock } from './clock.js';
import { Database } from './db/database.js';
import { Store } from './db/store.js';
import { RelayBus } from './engine/bus.js';
import type { EngineContext } from './engine/context.js';
import { DEFAULT_DELIVERY_OPTIONS, DeliveryWorker, type DeliveryOptions } from './engine/delivery.js';
import { DigestWorker } from './engine/digest.js';
import { IncidentService } from './engine/incidents.js';
import { Maintenance } from './engine/maintenance.js';
import { Notifier } from './engine/notifier.js';
import { Pipeline, type IngestMeta } from './engine/pipeline.js';
import { DEFAULT_SETTINGS, mergeSettings } from './engine/settings.js';
import { Topology } from './engine/topology.js';
import { silentLogger, type Logger } from './logger.js';
import { builtinPlugin } from './plugins/builtin.js';
import { setFormatLocale } from './plugins/format.js';
import { PluginRegistry } from './plugins/registry.js';
import { AdapterError, DeliveryError, httpRequest, type OpenRelayPlugin } from './plugins/types.js';
import type { EngineSettings, EventInput, IngestResult, ServiceDependency } from './types.js';
import { hmac, safeEqual } from './util/hash.js';
import { VERSION } from './version.js';

export interface OpenRelayOptions {
  /** SQLite file path or ":memory:". */
  databasePath: string;
  /** Base URL used in notification links, e.g. https://relay.example.com */
  publicUrl?: string;
  clock?: Clock;
  logger?: Logger;
  /** Directory with additional plugins. */
  pluginDir?: string | null;
  /** Extra plugins registered programmatically (e.g. in tests). */
  plugins?: OpenRelayPlugin[];
  /** Secret for signed action links. Generated and persisted when omitted. */
  secret?: string;
  delivery?: Partial<DeliveryOptions>;
  /** Initial settings merged over the stored ones on startup. */
  settings?: Partial<EngineSettings>;
}

/** The OpenRelay engine: storage, processing pipeline and background workers. */
export class OpenRelay {
  readonly db: Database;
  readonly store: Store;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly registry: PluginRegistry;
  readonly bus = new RelayBus();
  readonly publicUrl: string;
  readonly ctx: EngineContext;
  readonly notifier: Notifier;
  readonly incidents: IncidentService;
  readonly pipeline: Pipeline;
  readonly deliveries: DeliveryWorker;
  readonly digests: DigestWorker;
  readonly maintenance: Maintenance;
  readonly version = VERSION;

  private settingsCache: EngineSettings;
  private topologyCache: Topology;
  private learnedCache = new Map<string, number>();
  private readonly secret: string;
  private timers: NodeJS.Timeout[] = [];
  private ticking = false;

  private constructor(opts: OpenRelayOptions) {
    this.clock = opts.clock ?? systemClock;
    this.logger = opts.logger ?? silentLogger;
    this.publicUrl = (opts.publicUrl ?? 'http://localhost:8080').replace(/\/+$/, '');
    this.db = new Database(opts.databasePath);
    this.store = new Store(this.db);
    this.registry = new PluginRegistry(this.logger);
    this.registry.register(builtinPlugin, { builtin: true });

    this.secret = opts.secret ?? this.store.getSetting<string>('secret') ?? '';
    if (!this.secret) {
      this.secret = randomBytes(32).toString('base64url');
      this.store.setSetting('secret', this.secret);
    }

    const stored = this.store.getSetting<Partial<EngineSettings>>('engine');
    this.settingsCache = mergeSettings(DEFAULT_SETTINGS, stored ?? {});
    if (opts.settings) this.settingsCache = mergeSettings(this.settingsCache, opts.settings);
    setFormatLocale(this.settingsCache.locale);
    this.topologyCache = new Topology(this.store.listDependencies());
    this.reloadLearned();

    const self = this;
    this.ctx = {
      store: this.store,
      clock: this.clock,
      logger: this.logger,
      registry: this.registry,
      bus: this.bus,
      publicUrl: this.publicUrl,
      settings: () => self.settingsCache,
      topology: () => self.topologyCache,
      learned: (a, b) => self.learned(a, b),
      reloadLearned: () => self.reloadLearned(),
      sign: (id, action) => self.sign(id, action),
      wake: () => self.deliveries.wake(),
    };
    this.notifier = new Notifier(this.ctx);
    this.incidents = new IncidentService(this.ctx, this.notifier);
    this.pipeline = new Pipeline(this.ctx, this.incidents);
    this.deliveries = new DeliveryWorker(this.ctx, { ...DEFAULT_DELIVERY_OPTIONS, ...opts.delivery });
    this.digests = new DigestWorker(this.ctx);
    this.maintenance = new Maintenance(this.ctx, this.incidents, this.notifier);
  }

  static async create(opts: OpenRelayOptions): Promise<OpenRelay> {
    const relay = new OpenRelay(opts);
    for (const plugin of opts.plugins ?? []) relay.registry.register(plugin);
    if (opts.pluginDir) {
      await relay.registry.loadDirectory(opts.pluginDir, {
        logger: relay.logger,
        publicUrl: relay.publicUrl,
        version: VERSION,
        DeliveryError,
        AdapterError,
        httpRequest,
      });
    }
    return relay;
  }

  // ------------------------------------------------------------ settings & caches
  settings(): EngineSettings {
    return this.settingsCache;
  }

  updateSettings(patch: unknown): EngineSettings {
    const next = mergeSettings(this.settingsCache, patch);
    this.store.setSetting('engine', next);
    this.settingsCache = next;
    setFormatLocale(next.locale);
    return next;
  }

  topology(): Topology {
    return this.topologyCache;
  }

  setDependencies(items: ServiceDependency[]): void {
    this.store.replaceDependencies(items);
    this.topologyCache = new Topology(this.store.listDependencies());
  }

  learned(fpA: string, fpB: string): number {
    const key = fpA < fpB ? `${fpA}|${fpB}` : `${fpB}|${fpA}`;
    return this.learnedCache.get(key) ?? 0;
  }

  reloadLearned(): void {
    this.learnedCache = new Map(this.store.allLearned().map((l) => [`${l.fpA}|${l.fpB}`, l.weight]));
  }

  sign(incidentId: string, action: 'ack' | 'resolve'): string {
    return hmac(this.secret, `${incidentId}:${action}`).slice(0, 32);
  }

  verify(incidentId: string, action: 'ack' | 'resolve', signature: string): boolean {
    return safeEqual(this.sign(incidentId, action), signature);
  }

  // ------------------------------------------------------------ processing
  ingest(inputs: EventInput | EventInput[], meta?: IngestMeta): Promise<IngestResult[]> {
    return this.pipeline.ingest(Array.isArray(inputs) ? inputs : [inputs], meta);
  }

  /** Runs every periodic job once (escalations, digests, maintenance, deliveries). */
  async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const now = this.clock.now();
      this.notifier.escalate(now);
      this.digests.flush(now);
      this.maintenance.run(now);
      await this.deliveries.process();
    } finally {
      this.ticking = false;
    }
  }

  start(): void {
    this.deliveries.start(1000);
    const every = (ms: number, fn: () => void) => {
      const timer = setInterval(() => {
        try {
          fn();
        } catch (err) {
          this.logger.error({ err: (err as Error).message, stack: (err as Error).stack }, 'Hintergrundaufgabe fehlgeschlagen');
        }
      }, ms);
      timer.unref?.();
      this.timers.push(timer);
    };
    every(5_000, () => this.notifier.escalate(this.clock.now()));
    every(10_000, () => this.digests.flush(this.clock.now()));
    every(30_000, () => this.maintenance.run(this.clock.now()));
  }

  async stop(): Promise<void> {
    for (const timer of this.timers) clearInterval(timer);
    this.timers = [];
    await this.deliveries.stop();
  }

  async close(): Promise<void> {
    await this.stop();
    this.db.close();
  }
}
