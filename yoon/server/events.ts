import pg from 'pg';
import { EventEmitter } from 'node:events';
import type { Q } from './db.js';

/** Événement de suivi : diffusé via LISTEN/NOTIFY (fonctionne avec plusieurs instances) puis en SSE. */
export type LiveEvent = { orderId?: string; users: string[]; kind: string };

export async function publish(q: Q, ev: LiveEvent) {
  // Dans une transaction, NOTIFY n'est délivré qu'au commit : pas d'événement pour une action annulée.
  await q.query('select pg_notify($1, $2)', ['yoon_live', JSON.stringify(ev)]);
}

export class LiveBus extends EventEmitter {
  private client?: pg.Client;
  async start(url: string) {
    this.setMaxListeners(0);
    const c = new pg.Client({ connectionString: url });
    c.on('error', () => {
      // Reconnexion simple : les clients retombent sur le rafraîchissement périodique entre-temps.
      this.client = undefined;
      setTimeout(() => this.start(url).catch(() => {}), 3000);
    });
    await c.connect();
    await c.query('listen yoon_live');
    c.on('notification', (n) => {
      try {
        this.emit('event', JSON.parse(n.payload ?? '{}') as LiveEvent);
      } catch {
        /* ignore */
      }
    });
    this.client = c;
  }
  async stop() {
    await this.client?.end().catch(() => {});
  }
}
