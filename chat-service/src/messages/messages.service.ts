import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Message, MessageDocument } from './message.schema';
import { Conversation, ConversationDocument } from '../conversations/conversation.schema';
import { BlocksService } from '../blocks/blocks.service';
import { EventsService } from '../events/events.service';
import { SendDto } from '../gateway/ws.dto';
import { nextStatus, recipientsOf, statusAfterRead } from './message-status';
import { SystemPayload, systemDedupeKey, systemMessageText } from '../conversations/groups';
import { shapeConv } from '../conversations/conversations.service';
import { PageQuery, pageArgs, toPage } from '../common/pagination';

export function shapeMsg(msg: any) {
  if (!msg) return null;
  const id = msg.id ?? msg._id?.toString();
  return {
    id,
    conversationId: msg.conversationId,
    senderId: msg.senderId,
    content: msg.content,
    mediaUrls: msg.mediaUrls ?? [],
    status: msg.status ?? 'sent',
    type: msg.type ?? 'user',
    system: msg.system ?? null,
    post: msg.post ?? null,
    readBy: msg.readBy ?? [],
    reactions: msg.reactions ?? [],
    createdAt: msg.createdAt,
  };
}

@Injectable()
export class MessagesService {
  constructor(
    @InjectModel(Message.name) private messageModel: Model<MessageDocument>,
    @InjectModel(Conversation.name) private convModel: Model<ConversationDocument>,
    private blocks: BlocksService,
    private events: EventsService
  ) {}

  async assertMember(conversationId: string, userId: string): Promise<ConversationDocument> {
    const conv = await this.convModel.findById(conversationId);
    if (!conv) throw new NotFoundException({ code: 'CONVERSATION_NOT_FOUND', message: 'Conversation not found' });
    if (!conv.members.includes(userId)) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Not a member of this conversation' });
    }
    return conv;
  }

  /** `opts.post` is set only by the server-side share handler after it validated the post. */
  async send(senderId: string, dto: SendDto, opts: { post?: any } = {}) {
    const conv = await this.assertMember(dto.conversationId, senderId);
    const recipients = recipientsOf(conv.members, senderId);
    /**
     * Block policy:
     *  - direct chat: a block in either direction rejects the send outright (server-side), so the
     *    message never reaches the other side through REST, WS, or a retry.
     *  - group chat: the block does not tear the group apart, so the message is accepted but the
     *    blocked pair is excluded from delivery for this message.
     */
    if (conv.type !== 'group') await this.blocks.assertCanMessage(senderId, recipients);
    const { hidden } = await this.blocks.pairsFor(senderId);
    const excludedFromDelivery = recipients.filter((r) => hidden.has(r));
    const deliverTo = conv.type === 'group' ? recipients.filter((r) => !hidden.has(r)) : recipients;

    // An attachment-only message has empty text; keep the bubble meaningful in lists/notifications.
    const text = dto.content ?? '';
    const preview = opts.post ? `📎 Shared a post${text.trim() ? `: ${text.trim()}` : ''}` : text.trim() ? text : '📷 Photo';

    const msg = await this.messageModel.create({
      conversationId: dto.conversationId,
      senderId,
      content: text,
      mediaUrls: dto.mediaUrls ?? [],
      post: opts.post ?? null,
      status: 'sent',
      readBy: [],
      reactions: [],
    });

    conv.lastMessage = {
      id: msg._id.toString(),
      content: preview,
      senderId,
      createdAt: (msg as any).createdAt,
    };
    conv.hiddenFor = [];
    await conv.save();

    await this.events.publish('message.sent', {
      conversationId: dto.conversationId,
      senderId,
      recipientIds: deliverTo,
      preview,
    });

    return {
      message: shapeMsg(msg),
      conversation: conv,
      recipients: deliverTo,
      excludedFromDelivery,
    };
  }

  /**
   * Persists a membership/rename event as a first-class message so it survives a refresh and is
   * delivered through the same room as ordinary messages. A retried call inside the dedupe window
   * hits the unique index instead of writing a second event.
   */
  async appendSystem(conversationId: string, actorId: string, payload: SystemPayload) {
    const dedupeKey = systemDedupeKey(conversationId, payload);
    try {
      const msg = await this.messageModel.create({
        conversationId,
        senderId: actorId,
        content: systemMessageText(payload),
        mediaUrls: [],
        status: 'sent',
        readBy: [],
        reactions: [],
        type: 'system',
        system: payload,
        dedupeKey,
      });
      await this.convModel.updateOne(
        { _id: conversationId },
        // `system` carries the structured payload (not a boolean) so the conversation list can
        // show a readable label without re-resolving names for every row.
        { $set: { lastMessage: { id: msg._id.toString(), content: msg.content, senderId: actorId, createdAt: (msg as any).createdAt, system: payload } } }
      );
      return { message: shapeMsg(msg), deduped: false };
    } catch (e: any) {
      if (e?.code === 11000) return { message: null, deduped: true }; // duplicate delivery of the same event
      throw e;
    }
  }

  /** Delivered is recorded by the RECIPIENT's client once it actually receives/loads the message,
   *  never by the sender clicking Send. Only a member (and not the sender) may record it. */
  async markDelivered(messageId: string, byUserId?: string) {
    const msg = await this.messageModel.findById(messageId);
    if (!msg) return null;
    if (msg.type === 'system') return null; // membership events carry no delivery receipt
    if (byUserId) {
      if (msg.senderId === byUserId) return null; // the sender can't mark its own message delivered
      await this.assertMember(msg.conversationId, byUserId);
      if (await this.blocks.between(byUserId, msg.senderId)) {
        throw new ForbiddenException({ code: 'USER_BLOCKED', message: 'You cannot interact with this user' });
      }
    }
    const newStatus = nextStatus(msg.status, 'delivered');
    if (newStatus !== msg.status) {
      msg.status = newStatus;
      await msg.save();
      return { ...shapeMsg(msg), conversationId: msg.conversationId, senderId: msg.senderId };
    }
    return null;
  }

  async markRead(userId: string, conversationId: string, messageId: string) {
    await this.assertMember(conversationId, userId);
    const msg = await this.messageModel.findById(messageId);
    if (!msg) return null;
    if (msg.type === 'system') return null; // no read receipts for system events
    if (msg.senderId === userId) return null; // never "read" your own message
    // Reading implies contact with the sender: refuse it while a block exists.
    if (msg.senderId !== userId && (await this.blocks.between(userId, msg.senderId))) {
      throw new ForbiddenException({ code: 'USER_BLOCKED', message: 'You cannot interact with this user' });
    }

    const updated = statusAfterRead(msg.readBy, userId, msg.status);
    msg.status = updated.status;
    msg.readBy = updated.readBy;
    await msg.save();

    return {
      conversationId,
      messageId: msg._id.toString(),
      userId,
      readAt: new Date().toISOString(),
    };
  }

  /**
   * Marks EVERY unread message in a conversation as read for this user in one write, then returns
   * the authoritative counts. Per-message marking only covered the page the client had loaded, so
   * older unread messages kept the badge stuck at a number the user could never clear.
   */
  async markConversationRead(userId: string, conversationId: string) {
    await this.assertMember(conversationId, userId);
    const res = await this.messageModel.updateMany(
      { conversationId, senderId: { $ne: userId }, type: { $ne: 'system' }, readBy: { $ne: userId } },
      { $addToSet: { readBy: userId }, $set: { status: 'read' } },
    );
    const counts = await this.unread(userId);
    return { conversationId, marked: res.modifiedCount ?? 0, ...counts };
  }

  async react(userId: string, messageId: string, emoji: string) {
    const msg = await this.messageModel.findById(messageId);
    if (!msg) throw new NotFoundException({ code: 'MESSAGE_NOT_FOUND', message: 'Message not found' });
    await this.assertMember(msg.conversationId, userId);
    if (msg.senderId !== userId && (await this.blocks.between(userId, msg.senderId))) {
      throw new ForbiddenException({ code: 'USER_BLOCKED', message: 'You cannot interact with this user' });
    }

    msg.reactions = msg.reactions.filter((r) => r.userId !== userId);
    msg.reactions.push({ userId, emoji, createdAt: new Date() });
    await msg.save();

    return {
      conversationId: msg.conversationId,
      messageId: msg._id.toString(),
      reactions: msg.reactions,
    };
  }

  async unreact(userId: string, messageId: string) {
    const msg = await this.messageModel.findById(messageId);
    if (!msg) throw new NotFoundException({ code: 'MESSAGE_NOT_FOUND', message: 'Message not found' });
    await this.assertMember(msg.conversationId, userId);
    if (msg.senderId !== userId && (await this.blocks.between(userId, msg.senderId))) {
      throw new ForbiddenException({ code: 'USER_BLOCKED', message: 'You cannot interact with this user' });
    }

    msg.reactions = msg.reactions.filter((r) => r.userId !== userId);
    await msg.save();

    return {
      conversationId: msg.conversationId,
      messageId: msg._id.toString(),
      reactions: msg.reactions,
    };
  }

  /** Unread = messages I did not send that my readBy list does not contain, per visible conversation. */
  async unread(userId: string): Promise<{ total: number; byConversation: Record<string, number> }> {
    const convs = await this.convModel.find({ members: userId, hiddenFor: { $ne: userId } }).select('_id').lean();
    const ids = convs.map((c: any) => c._id.toString());
    if (!ids.length) return { total: 0, byConversation: {} };
    const rows = await this.messageModel.aggregate([
      // System notices ("A added B", "group renamed") are not messages anyone has to read, so they
      // must not inflate the unread badge.
      { $match: { conversationId: { $in: ids }, senderId: { $ne: userId }, readBy: { $ne: userId }, type: { $ne: 'system' } } },
      { $group: { _id: '$conversationId', count: { $sum: 1 } } },
    ]);
    const byConversation: Record<string, number> = {};
    let total = 0;
    for (const r of rows) { byConversation[String(r._id)] = r.count; total += r.count; }
    return { total, byConversation };
  }

  async list(conversationId: string, userId: string, q: PageQuery) {
    await this.assertMember(conversationId, userId);

    const query: any = { conversationId };
    if (q.cursor) {
      query._id = { $lt: q.cursor };
    }

    const rows = await this.messageModel
      .find(query)
      .sort({ _id: -1 })
      .limit(q.limit + 1)
      .lean();

    const formatted = rows.map((r) => ({ ...shapeMsg(r), id: r._id.toString() }));
    const more = formatted.length > q.limit;
    const items = more ? formatted.slice(0, q.limit) : formatted;
    const nextCursor = more ? items[items.length - 1].id : null;

    return { items, nextCursor };
  }
}
