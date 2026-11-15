import { Injectable } from '@nestjs/common';
import { RedisService } from './redis.service';

export const PRESENCE_CHANNEL = 'presence-events';
/** Heartbeat every 20s; a key is stale (browser killed, host slept) after 60s without one. */
const TTL_SECONDS = 60;
const LAST_SEEN_TTL_SECONDS = 60 * 60 * 24 * 30;

const connKey = (userId: string) => `presence:conn:${userId}`;
const seenKey = (userId: string) => `presence:last:${userId}`;

/**
 * Connection registry behind online/offline presence.
 *
 * Each authenticated socket registers its own id, so:
 *  - several tabs/devices of the same user stay online until the *last* one disconnects,
 *  - a dead tab (no disconnect event) expires on its own once the key's TTL lapses,
 *  - `lastSeen` survives restarts and is shared between service instances via Redis.
 *
 * With no Redis available it falls back to an in-process registry with the same semantics
 * (single-instance development), so presence is never a static default.
 */
@Injectable()
export class PresenceService {
  private memoryConn = new Map<string, Set<string>>();
  private memorySeen = new Map<string, string>();

  constructor(private redis: RedisService) {}

  /**
   * A restart kills every socket, so any connection ids still registered at boot are orphans from
   * the previous process. Left behind, they keep a user "online" forever and suppress the offline
   * event (their last socket never looks like the last one). Called once, before sockets are served.
   * NOTE: assumes a single chat-service instance, which is how this stack is deployed.
   */
  async clearStaleConnections(): Promise<void> {
    const store: any = this.store;
    if (store?.scan) {
      try {
        let cursor = '0';
        do {
          const [next, keys] = await store.scan(cursor, 'MATCH', 'presence:conn:*', 'COUNT', 200);
          cursor = String(next);
          if (keys?.length) await store.del(...keys);
        } while (cursor !== '0');
      } catch { /* fall back to the in-memory registry */ }
    }
    this.memoryConn.clear();
  }

  private get store() {
    const r: any = this.redis?.pub;
    return r && typeof r.sadd === 'function' ? r : null;
  }

  /** Records an authenticated connection and refreshes its heartbeat. */
  async heartbeat(userId: string, socketId?: string): Promise<void> {
    const iso = new Date().toISOString();
    if (!userId) return;
    if (socketId) {
      const set = this.store;
      if (set) await set.sadd(connKey(userId), socketId).catch(() => {});
      else { let s = this.memoryConn.get(userId); if (!s) this.memoryConn.set(userId, (s = new Set())); s.add(socketId); }
    }
    await this.touch(userId, iso);
    if (this.store) await this.store.expire(connKey(userId), TTL_SECONDS).catch(() => {});
  }

  /** Only updates the timestamp (gateway heartbeat interval). */
  private async touch(userId: string, iso: string) {
    if (this.store) {
      await this.store.set(seenKey(userId), iso, 'EX', LAST_SEEN_TTL_SECONDS).catch(() => {});
      await this.store.expire(connKey(userId), TTL_SECONDS).catch(() => {});
    } else {
      this.memorySeen.set(userId, iso);
    }
  }

  /** Removes one connection; returns true when no other tab/device remains. */
  async clear(userId: string, socketId?: string): Promise<{ offline: boolean }> {
    if (!userId) return { offline: false };
    if (socketId && this.store) await this.store.srem(connKey(userId), socketId).catch(() => {});
    else if (socketId) this.memoryConn.get(userId)?.delete(socketId);
    const online = await this.isOnline(userId);
    await this.touch(userId, new Date().toISOString());
    return { offline: !online };
  }

  async isOnline(userId: string): Promise<boolean> {
    if (!userId) return false;
    if (this.store) {
      try {
        const n = await this.store.scard(connKey(userId));
        return Number(n) > 0;
      } catch { /* fall through to memory */ }
    }
    return (this.memoryConn.get(userId)?.size ?? 0) > 0;
  }

  async lastSeen(userId: string): Promise<string> {
    if (!userId) return new Date().toISOString();
    if (this.store) {
      try {
        const v = await this.store.get(seenKey(userId));
        if (v) return String(v);
      } catch { /* fall through */ }
    }
    return this.memorySeen.get(userId) ?? new Date().toISOString();
  }

  /** Batch snapshot for a conversation (only callers who already know the member ids ask for this). */
  async snapshot(userIds: string[]): Promise<Array<{ userId: string; online: boolean; lastSeenAt: string }>> {
    const ids = [...new Set(userIds.filter(Boolean))].slice(0, 100);
    return Promise.all(ids.map(async (userId) => ({
      userId,
      online: await this.isOnline(userId),
      lastSeenAt: await this.lastSeen(userId),
    })));
  }

  /** Publishes to every service instance so each can update its local sockets. */
  async publish(data: { userId: string; status: 'online' | 'offline'; lastSeenAt: string; conversationIds: string[] }): Promise<void> {
    await this.redis.publish(PRESENCE_CHANNEL, JSON.stringify(data));
  }

  async setTyping(_conversationId: string, _userId: string, _isTyping: boolean): Promise<void> {
    // Typing is transient and lives in the gateway (per-connection timers); kept for call-site stability.
  }
}
