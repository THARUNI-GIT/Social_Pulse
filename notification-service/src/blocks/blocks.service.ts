import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Schema, SchemaFactory, Prop } from '@nestjs/mongoose';
import { Model, Document } from 'mongoose';
import { RetryingConsumer } from '../common/amqp-consumer';

@Schema({ collection: 'blocks' })
export class Block {
  @Prop({ required: true }) blockerId: string;
  @Prop({ required: true }) blockedId: string;
}
export const BlockSchema = SchemaFactory.createForClass(Block);
BlockSchema.index({ blockerId: 1, blockedId: 1 }, { unique: true });
export type BlockDoc = Block & Document;

/**
 * Local replica of user-service blocks (fed by `user.blocked` / `user.unblocked`).
 *
 * Notifications caused by one party are never shown to the other while a block exists
 * (mutual hiding), so a blocked user cannot keep generating activity alerts.
 */
@Injectable()
export class BlocksService implements OnModuleInit, OnModuleDestroy {
  private consumer: RetryingConsumer | null = null;
  constructor(@InjectModel(Block.name) private model: Model<BlockDoc>) {}


  /** Full resync from the authoritative block graph in user-service (idempotent, run at startup). */
  async reconcile(attempt = 0): Promise<void> {
    const base = process.env.USER_SERVICE_URL || 'http://user-service:3003';
    try {
      const res = await fetch(`${base}/users/blocks/all`, { signal: AbortSignal.timeout(3000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body: any = await res.json();
      const rows: Array<{ blockerId: string; blockedId: string }> = body?.data?.items ?? body?.items ?? [];
      const remote = new Set(rows.map((r) => `${r.blockerId}>${r.blockedId}`));
      if (rows.length) {
        await this.model.bulkWrite(rows.map((r) => ({ updateOne: { filter: { blockerId: r.blockerId, blockedId: r.blockedId }, update: { $setOnInsert: r }, upsert: true } })) as any);
      }
      const stale = await this.model.find().lean();
      const toDelete = stale.filter((l) => !remote.has(`${l.blockerId}>${l.blockedId}`)).map((l: any) => l._id);
      if (toDelete.length) await this.model.deleteMany({ _id: { $in: toDelete } });
    } catch (e: any) {
      if (attempt < 10) setTimeout(() => void this.reconcile(attempt + 1), 3_000);
    }
  }

  async eitherWay(a: string, b: string): Promise<boolean> {
    if (!a || !b || a === b) return false;
    const n = await this.model.countDocuments({ $or: [{ blockerId: a, blockedId: b }, { blockerId: b, blockedId: a }] }).limit(1);
    return n > 0;
  }

  async onModuleInit() {
    this.consumer = new RetryingConsumer({
      logName: 'NotificationBlocks',
      queue: 'notification-service.blocks',
      bindings: ['user.blocked', 'user.unblocked'],
      handle: async (routingKey, e) => {
        const key = { blockerId: e.blockerId, blockedId: e.blockedId };
        if (routingKey === 'user.blocked') await this.model.updateOne(key, { $setOnInsert: key }, { upsert: true });
        else await this.model.deleteOne(key);
      },
    });
    this.consumer.start();
    void this.reconcile(); // heal events lost before this replica existed / during a broker outage
  }
  async onModuleDestroy() { await this.consumer?.onModuleDestroy(); }
}
