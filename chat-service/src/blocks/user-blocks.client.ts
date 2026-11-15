import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';

/**
 * Asks user-service whether two users block each other, over the internal network
 * (`POST /users/blocks/check`, deliberately not routable through the gateway).
 *
 * chat-service also keeps a replica of blocks fed by `user.blocked` / `user.unblocked`, but that is
 * eventually consistent: a block followed immediately by a message could arrive before the event.
 * This client is the authoritative fallback that closes that window. Results are cached briefly so
 * a chatty conversation does not turn into one HTTP call per message.
 */
@Injectable()
export class UserBlocksClient {
  private log = new Logger('UserBlocksClient');
  private baseUrl = process.env.USER_SERVICE_URL || 'http://user-service:3003';
  private cache = new Map<string, { blocked: boolean; at: number }>();
  /** Negative results expire quickly (a block may be created any moment); positives linger. */
  private ttl = (blocked: boolean) => (blocked ? 30_000 : 5_000);

  private key(a: string, b: string) { return [a, b].sort().join(':'); }

  /** `true`/`false` from user-service, or `null` when it could not be reached. */
  async blockedEitherWay(a: string, b: string): Promise<boolean | null> {
    const k = this.key(a, b);
    const hit = this.cache.get(k);
    if (hit && Date.now() - hit.at < this.ttl(hit.blocked)) return hit.blocked;
    try {
      const res = await axios.post(`${this.baseUrl}/users/blocks/check`, { a, b }, { timeout: 2000 });
      const body = res.data;
      const blocked = !!(body?.data?.blocked ?? body?.blocked);
      this.cache.set(k, { blocked, at: Date.now() });
      return blocked;
    } catch (e: any) {
      this.log.warn(`block lookup failed (${e?.message}); falling back to the local replica`);
      return null;
    }
  }

  /** Full authoritative block graph, used to resync the local replica at startup. */
  async allBlocks(): Promise<Array<{ blockerId: string; blockedId: string }> | null> {
    try {
      const res = await axios.get(`${this.baseUrl}/users/blocks/all`, { timeout: 3000 });
      const rows = res.data?.data?.items ?? res.data?.items ?? [];
      return Array.isArray(rows) ? rows : [];
    } catch (e: any) {
      this.log.warn(`block list failed (${e?.message})`);
      return null;
    }
  }
}
