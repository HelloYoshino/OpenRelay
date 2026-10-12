import { EventEmitter } from 'node:events';
import type { Alert, Delivery, Incident, StoredEvent } from '../types.js';

export interface BusEvents {
  incident: [Incident];
  alert: [Alert];
  event: [StoredEvent];
  delivery: [Pick<Delivery, 'id' | 'status' | 'channelId' | 'incidentId' | 'kind'>];
}

/** In-process pub/sub used by the live stream (SSE) and plugins. */
export class RelayBus extends EventEmitter<BusEvents> {
  constructor() {
    super();
    this.setMaxListeners(1000);
  }
}
