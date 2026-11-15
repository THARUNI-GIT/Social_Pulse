import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import axios from 'axios';
import { PrismaService } from '../common/prisma.service';
import { RetryingConsumer } from '../common/amqp-consumer';

const CACHE_TTL_MS = 5_000;

/**
 * Local replica of the user-service block graph (fed by `user.blocked` / `user.unblocked`).
 *
 * Visibility policy — **mutual hiding**: while a block exists between A and B,
 *   * neither sees the other's posts anywhere (feed, direct view, profile grid, hashtag,
 *     bookmarks, search results),
 *   * neither sees the other's comments,
 *   * neither can follow the other (severed on block by user-service),
 *   * direct messaging is rejected server-side,
 *   * notifications caused by one are not shown to the other.
 *
 * Unblocking restores exactly what the normal visibility rules would allow again.
 *
 * The replica is eventually consistent (events), so it is only used to *hide* content — a small
 * negative cache keeps the feed path off the database without widening exposure for long.
 */
@Injectable()
export class BlocksService implements OnModuleInit, OnModuleDestroy {
  private consumer: RetryingConsumer | null = null;
  private log = new Logger('Blocks');
  private cache = new Map<string, { ids: string[]; at: number }>();

  constructor(private db: PrismaService) {}

  /** User ids hidden from `viewer` in either direction. Never includes the viewer. */
  async hiddenIds(viewer: string): Promise<string[]> {
    if (!viewer) return [];
    const hit = this.cache.get(viewer);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.ids;
    const rows = await this.db.block.findMany({
      where: { OR: [{ blockerId: viewer }, { blockedId: viewer }] },
      select: { blockerId: true, blockedId: true },
    });
    const ids = [...new Set(rows.map((r) => (r.blockerId === viewer ? r.blockedId : r.blockerId)))].filter((id) => id !== viewer);
    this.cache.set(viewer, { ids, at: Date.now() });
    return ids;
  }

  /** Is there a block in either direction? Uses the shared cache for the viewer side. */
  async isBlockedEitherWay(a: string, b: string): Promise<boolean> {
    if (!a || !b || a === b) return false;
    const row = await this.db.block.findFirst({
      where: { OR: [{ blockerId: a, blockedId: b }, { blockerId: b, blockedId: a }] },
      select: { blockerId: true },
    });
    return !!row;
  }

  /** Called right after a block/unblock so queries never read a stale cache. */
  invalidate(viewer?: string) {
    if (viewer) this.cache.delete(viewer);
    else this.cache.clear();
  }

  async onModuleInit() {
    this.consumer = new RetryingConsumer({
      logName: 'BlocksConsumer',
      queue: 'content-service.blocks',
      bindings: ['user.blocked', 'user.unblocked'],
      handle: async (routingKey, e) => {
        const key = { blockerId: e.blockerId, blockedId: e.blockedId };
        if (routingKey === 'user.blocked') {
          await this.db.block.upsert({ where: { blockerId_blockedId: key }, create: key, update: {} });
          this.log.debug(`block recorded ${key.blockerId} -> ${key.blockedId}`);
        } else {
          await this.db.block.deleteMany({ where: key });
        }
        // Both sides' caches are affected: a block hides content for blocker *and* blocked.
        this.invalidate(e.blockerId);
        this.invalidate(e.blockedId);
      },
    });
    this.consumer.start();
    void this.reconcile(); // heal events lost before this replica existed / during a broker outage
  }

  /** Full resync from the authoritative block graph in user-service (idempotent, run at startup). */
  async reconcile(attempt = 0): Promise<void> {
    const base = process.env.USER_SERVICE_URL || 'http://user-service:3003';
    try {
      const res = await axios.get(`${base}/users/blocks/all`, { timeout: 3000 });
      const rows: Array<{ blockerId: string; blockedId: string }> = res.data?.data?.items ?? res.data?.items ?? [];
      const remote = new Set(rows.map((r) => `${r.blockerId}>${r.blockedId}`));
      await this.db.$transaction(async (tx) => {
        for (const r of rows) {
          const key = { blockerId: r.blockerId, blockedId: r.blockedId };
          await tx.block.upsert({ where: { blockerId_blockedId: key }, create: key, update: {} });
        }
        const local = await tx.block.findMany({ select: { blockerId: true, blockedId: true } });
        for (const l of local) {
          if (!remote.has(`${l.blockerId}>${l.blockedId}`)) await tx.block.delete({ where: { blockerId_blockedId: l } });
        }
      });
      this.cache.clear();
      this.log.log(`blocks reconciled with user-service (${rows.length})`);
    } catch (e: any) {
      // user-service may still be starting; keep trying a bounded number of times.
      if (attempt < 10) setTimeout(() => void this.reconcile(attempt + 1), 3_000);
      else this.log.warn(`block reconciliation gave up: ${e?.message}`);
    }
  }

  async onModuleDestroy() {
    await this.consumer?.onModuleDestroy();
  }
}
