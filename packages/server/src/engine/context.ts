import type { Clock } from '../clock.js';
import type { Store } from '../db/store.js';
import type { Logger } from '../logger.js';
import type { PluginRegistry } from '../plugins/registry.js';
import type { EngineSettings } from '../types.js';
import type { RelayBus } from './bus.js';
import type { Topology } from './topology.js';

/** Shared services handed to all engine components. */
export interface EngineContext {
  store: Store;
  clock: Clock;
  logger: Logger;
  registry: PluginRegistry;
  bus: RelayBus;
  publicUrl: string;
  settings(): EngineSettings;
  topology(): Topology;
  /** +1 learned link, -1 learned separation, 0 unknown. */
  learned(fpA: string, fpB: string): number;
  reloadLearned(): void;
  sign(incidentId: string, action: 'ack' | 'resolve'): string;
  /** Wakes the delivery worker after new deliveries were queued. */
  wake(): void;
}
