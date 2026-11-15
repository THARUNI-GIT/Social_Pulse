import { ForbiddenException, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectModel, Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { RetryingConsumer } from '../common/amqp-consumer';
import { blockKey, isBlockedEitherWay } from './blocks';
import { UserBlocksClient } from './user-blocks.client';

@Schema({ collection: 'blocks' }) export class Block { @Prop({ required: true }) blockerId: string; @Prop({ required: true }) blockedId: string; }
export const BlockSchema = SchemaFactory.createForClass(Block); BlockSchema.index({ blockerId: 1, blockedId: 1 }, { unique: true });

/** Local replica of user-service blocks (fed by user.blocked / user.unblocked). */
@Injectable()
export class BlocksService implements OnModuleInit, OnModuleDestroy {
  private consumer: RetryingConsumer | null = null;
  constructor(@InjectModel(Block.name) private model: Model<Block>, private authoritative: UserBlocksClient) {}
  async between(a: string, b: string) {
    const rows = await this.model.find({ $or: [{ blockerId: a, blockedId: b }, { blockerId: b, blockedId: a }] }).lean();
    if (isBlockedEitherWay(new Set(rows.map((r) => blockKey(r.blockerId, r.blockedId))), a, b)) return true;
    // The replica has not seen a block (yet): confirm against user-service so a block is never
    // bypassed by racing the event stream. If user-service is unreachable we keep the replica's
    // answer, so a downstream outage cannot silently disable blocking OR block every message.
    return (await this.authoritative.blockedEitherWay(a, b)) === true;
  }
  /** Call from MessagesService.send / conversation creation: throws if any recipient is blocked either way. */
  async assertCanMessage(sender: string, recipients: string[]) {
    for (const r of recipients) if (await this.between(sender, r)) throw new ForbiddenException({ code: 'USER_BLOCKED', message: 'You cannot message this user' });
  }
  /**
   * Directional block state for the caller, used to render the blocked-contact notice and to show
   * an Unblock action only to the person who blocked (the blocked party cannot unblock).
   */
  async pairsFor(me: string): Promise<{ hidden: Set<string>; blockedByMe: Set<string> }> {
    const rows = await this.model.find({ $or: [{ blockerId: me }, { blockedId: me }] }).lean();
    const hidden = new Set<string>();
    const blockedByMe = new Set<string>();
    for (const r of rows) {
      if (r.blockerId === me) { blockedByMe.add(r.blockedId); hidden.add(r.blockedId); }
      else hidden.add(r.blockerId);
    }
    return { hidden, blockedByMe };
  }

  /** Users hidden from `me` (both directions) - filter conversation lists / user lookups with this. */
  async hiddenFor(me: string): Promise<string[]> {
    const rows = await this.model.find({ $or: [{ blockerId: me }, { blockedId: me }] }).lean();
    return [...new Set(rows.map((r) => (r.blockerId === me ? r.blockedId : r.blockerId)))];
  }
  async onModuleInit() {
    this.consumer = new RetryingConsumer({
      logName: 'Blocks',
      queue: 'chat-service.blocks',
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

  /** Full resync from the authoritative block graph in user-service (idempotent, run at startup). */
  async reconcile(attempt = 0): Promise<void> {
    const rows = await this.authoritative.allBlocks();
    if (!rows) {
      if (attempt < 10) setTimeout(() => void this.reconcile(attempt + 1), 3_000);
      return;
    }
    const remote = new Set(rows.map((r) => `${r.blockerId}>${r.blockedId}`));
    const ops = rows.map((r) => ({ updateOne: { filter: { blockerId: r.blockerId, blockedId: r.blockedId }, update: { $setOnInsert: r }, upsert: true } }));
    if (ops.length) await this.model.bulkWrite(ops as any).catch(() => {});
    // Drop local rows that are no longer in the authoritative graph (unblocks survived).
    const stale = await this.model.find().lean();
    const toDelete = stale.filter((l) => !remote.has(`${l.blockerId}>${l.blockedId}`)).map((l) => l._id);
    if (toDelete.length) await this.model.deleteMany({ _id: { $in: toDelete } }).catch(() => {});
  }

  async onModuleDestroy() { await this.consumer?.onModuleDestroy(); }
}
