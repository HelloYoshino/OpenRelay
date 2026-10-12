import type { EngineContext } from './context.js';
import { buildDigestMessage } from './message.js';

/** Flushes collected low-priority incidents as one summary per channel. */
export class DigestWorker {
  constructor(private readonly ctx: EngineContext) {}

  flush(now: number): number {
    let sent = 0;
    for (const channelId of this.ctx.store.dueDigestChannels(now)) {
      this.ctx.store.tx(() => {
        const items = this.ctx.store.digestItems(channelId);
        const channel = this.ctx.store.getChannel(channelId);
        const ids = [...new Set(items.map((i) => i.incidentId))];
        const incidents = this.ctx.store.getIncidentsByIds(ids);
        if (channel?.enabled && incidents.length > 0) {
          const minutes = Math.max(...items.map((i) => i.intervalMinutes));
          const message = buildDigestMessage(this.ctx, incidents, minutes);
          const id = this.ctx.store.insertDelivery({
            channelId,
            incidentId: null,
            routeId: items[0]?.routeId ?? null,
            kind: 'digest',
            message,
            now,
            dedupeKey: `digest:${channelId}:${now}`,
          });
          if (id !== null) {
            this.ctx.bus.emit('delivery', { id, status: 'pending', channelId, incidentId: null, kind: 'digest' });
            sent++;
          }
        }
        this.ctx.store.deleteDigestItems(items.map((i) => i.id));
      });
    }
    if (sent > 0) this.ctx.wake();
    return sent;
  }
}
