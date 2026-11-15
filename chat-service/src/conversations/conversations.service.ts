import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Conversation, ConversationDocument } from './conversation.schema';
import { BlocksService } from '../blocks/blocks.service';
import { buildGroupMembers, isUserId, normalizeGroupName, SystemPayload } from './groups';
import { MessagesService } from '../messages/messages.service';

export function shapeConv(conv: any) {
  if (!conv) return null;
  const id = conv.id ?? conv._id?.toString();
  return {
    id,
    type: conv.type ?? 'direct',
    name: conv.name ?? null,
    members: conv.members ?? [],
    admins: conv.admins ?? [],
    createdBy: conv.createdBy ?? null,
    hiddenFor: conv.hiddenFor ?? [],
    lastMessage: conv.lastMessage ?? null,
    updatedAt: conv.updatedAt ?? conv.createdAt,
    createdAt: conv.createdAt,
  };
}

@Injectable()
export class ConversationsService {
  rooms: {
    join: (userId: string, conversationId: string) => void;
    leave: (userId: string, conversationId: string) => void;
    emitUpdated: (conversation: any) => void;
    emitToUser: (userId: string, event: string, payload: any) => void;
    emitToConversation: (conversationId: string, event: string, payload: any) => void;
  } = {
    join: () => {},
    leave: () => {},
    emitUpdated: () => {},
    emitToUser: () => {},
    emitToConversation: () => {},
  };

  constructor(
    @InjectModel(Conversation.name) private model: Model<ConversationDocument>,
    private blocks: BlocksService,
    private msgs: MessagesService
  ) {}

  /**
   * Records a membership event and pushes it to everyone still in the group. Persisting first means
   * the event is still there after a refresh, even if the live emit is missed.
   */
  private async systemEvent(conversationId: string, actorId: string, payload: SystemPayload) {
    const { message, deduped } = await this.msgs.appendSystem(conversationId, actorId, payload);
    if (message && !deduped) this.rooms.emitToConversation(conversationId, 'message:new', { message });
    return message;
  }

  /** Re-reads the conversation so `lastMessage` (now the system event) is accurate in the payload. */
  private async emitFresh(conversationId: string) {
    const doc = await this.model.findById(conversationId).lean();
    if (doc) this.rooms.emitUpdated(shapeConv(doc));
  }

  async idsForUser(userId: string): Promise<string[]> {
    const list = await this.model
      .find({ members: userId, hiddenFor: { $ne: userId } })
      .select('_id')
      .lean();
    return list.map((c) => c._id.toString());
  }

  async findOrCreateDirect(userId: string, otherUserId: string): Promise<any> {
    if (userId === otherUserId) throw new BadRequestException({ code: 'SELF_CONVERSATION', message: "You can't message yourself" });
    await this.blocks.assertCanMessage(userId, [otherUserId]);

    let conv = await this.model.findOne({
      type: 'direct',
      members: { $all: [userId, otherUserId], $size: 2 },
    });

    if (!conv) {
      conv = await this.model.create({
        type: 'direct',
        members: [userId, otherUserId],
        hiddenFor: [],
      });
      this.rooms.join(userId, conv._id.toString());
      this.rooms.join(otherUserId, conv._id.toString());
    } else if (conv.hiddenFor.includes(userId)) {
      conv.hiddenFor = conv.hiddenFor.filter((id) => id !== userId);
      await conv.save();
    }

    return shapeConv(conv);
  }

  // ---- groups ----
  /** Creates a group with the caller as owner/admin. */
  async createGroup(userId: string, rawName: unknown, invited: unknown): Promise<any> {
    const name = normalizeGroupName(rawName);
    if (!name) throw new BadRequestException({ code: 'INVALID_NAME', message: 'A group needs a name' });
    const { members, error } = buildGroupMembers(userId, invited);
    if (error === 'INVALID_MEMBER') throw new BadRequestException({ code: 'INVALID_MEMBER', message: 'Member ids must be user ids' });
    if (error === 'TOO_FEW') throw new BadRequestException({ code: 'TOO_FEW_MEMBERS', message: 'Add at least one other member' });
    if (error === 'TOO_MANY') throw new BadRequestException({ code: 'TOO_MANY_MEMBERS', message: 'That group is too large' });

    const conv = await this.model.create({ type: 'group', name, members, admins: [userId], createdBy: userId, hiddenFor: [] });
    const id = conv._id.toString();
    // Every member joins the socket room immediately so messages flow without a reconnect.
    for (const m of members) {
      this.rooms.join(m, id);
      this.rooms.emitToUser(m, 'conversation:created', { conversation: shapeConv(conv) });
    }
    await this.systemEvent(id, userId, { event: 'created', actorId: userId, name });
    await this.emitFresh(id);
    return shapeConv(conv);
  }

  /** Membership-checked read; used by the group info panel. */
  async getForUser(id: string, userId: string): Promise<any> {
    const conv = await this.model.findById(id).lean();
    if (!conv) throw new NotFoundException({ code: 'CONVERSATION_NOT_FOUND', message: 'Conversation not found' });
    if (!conv.members?.includes(userId)) throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Not a member of this conversation' });
    return shapeConv(conv);
  }

  async members(id: string, userId: string) {
    const conv = await this.getForUser(id, userId);
    return { id, members: conv.members, admins: conv.admins, createdBy: conv.createdBy, type: conv.type };
  }

  private async groupForAdmin(id: string, userId: string) {
    const conv = await this.model.findById(id);
    if (!conv) throw new NotFoundException({ code: 'CONVERSATION_NOT_FOUND', message: 'Conversation not found' });
    if (conv.type !== 'group') throw new BadRequestException({ code: 'NOT_A_GROUP', message: 'This conversation is not a group' });
    if (!conv.members.includes(userId)) throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Not a member of this conversation' });
    if (!conv.admins.includes(userId)) throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Only group admins can do that' });
    return conv;
  }

  /** Adds members (admin only). Blocked pairings are rejected rather than silently allowed. */
  async addMembers(actorId: string, id: string, invited: unknown) {
    const conv = await this.groupForAdmin(id, actorId);
    const list = [...new Set((Array.isArray(invited) ? invited : []).filter(isUserId))];
    if (!list.length) throw new BadRequestException({ code: 'INVALID_MEMBER', message: 'Provide at least one user id' });
    const fresh = list.filter((u) => !conv.members.includes(u));
    for (const u of fresh) await this.blocks.assertCanMessage(actorId, [u]);

    conv.members = [...conv.members, ...fresh];
    // A member who previously left becomes visible again.
    conv.hiddenFor = conv.hiddenFor.filter((u) => !fresh.includes(u));
    await conv.save();

    const shaped = shapeConv(conv);
    for (const u of fresh) {
      this.rooms.join(u, id);
      this.rooms.emitToUser(u, 'conversation:created', { conversation: shaped });
    }
    // One event per genuinely added member (already-present ids produce nothing).
    for (const u of fresh) await this.systemEvent(id, actorId, { event: 'member_added', actorId, targetId: u });
    this.rooms.emitUpdated(shaped);
    if (fresh.length) await this.emitFresh(id);
    return shaped;
  }

  /** Removes a member (admin), or lets a member leave. */
  async removeMember(actorId: string, id: string, targetId: string) {
    const conv = await this.model.findById(id);
    if (!conv) throw new NotFoundException({ code: 'CONVERSATION_NOT_FOUND', message: 'Conversation not found' });
    if (conv.type !== 'group') throw new BadRequestException({ code: 'NOT_A_GROUP', message: 'This conversation is not a group' });
    if (!conv.members.includes(actorId)) throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Not a member of this conversation' });
    const leavingSelf = actorId === targetId;
    if (!leavingSelf && !conv.admins.includes(actorId)) throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Only group admins can remove members' });
    if (!conv.members.includes(targetId)) throw new NotFoundException({ code: 'NOT_A_MEMBER', message: 'That user is not in this group' });

    conv.members = conv.members.filter((u) => u !== targetId);
    conv.admins = conv.admins.filter((u) => u !== targetId);
    if (!conv.hiddenFor.includes(targetId)) conv.hiddenFor.push(targetId);
    // Never leave a group without an admin: promote the longest-standing member.
    if (conv.admins.length === 0 && conv.members.length && conv.createdBy === targetId) conv.createdBy = conv.members[0];
    if (conv.admins.length === 0 && conv.members.length) conv.admins = [conv.members[0]];
    if (!conv.members.length) { await conv.deleteOne(); }
    else await conv.save();

    // The target's sockets leave first, so a removal notice only reaches the members who remain.
    this.rooms.leave(targetId, id);
    this.rooms.emitToUser(targetId, 'conversation:removed', { conversationId: id });
    if (conv.members.length) {
      await this.systemEvent(id, actorId, {
        event: leavingSelf ? 'member_left' : 'member_removed',
        actorId,
        targetId,
      });
      await this.emitFresh(id);
    }
    return { id, removed: targetId, left: leavingSelf };
  }

  /** Promote an existing member to group admin (admins only). */
  async promote(actorId: string, id: string, targetId: string) {
    const conv: any = await this.groupForAdmin(id, actorId);
    if (!conv.members.includes(targetId)) throw new NotFoundException({ code: 'MEMBER_NOT_FOUND', message: 'Not a member of this group' });
    if (!conv.admins.includes(targetId)) { conv.admins.push(targetId); await conv.save(); }
    const shaped = shapeConv(await this.model.findById(id).lean());
    this.rooms.emitUpdated(shaped);
    return shaped;
  }

  async rename(actorId: string, id: string, rawName: unknown) {
    const conv = await this.groupForAdmin(id, actorId);
    const name = normalizeGroupName(rawName);
    if (!name) throw new BadRequestException({ code: 'INVALID_NAME', message: 'A group needs a name' });
    if (conv.name === name) return shapeConv(conv); // no-op rename records nothing
    conv.name = name;
    await conv.save();
    await this.systemEvent(id, actorId, { event: 'renamed', actorId, name });
    const shaped = shapeConv(conv);
    this.rooms.emitUpdated(shaped);
    return shaped;
  }

  async list(userId: string): Promise<any[]> {
    const list = await this.model
      .find({ members: userId, hiddenFor: { $ne: userId } })
      .sort({ updatedAt: -1 })
      .lean();
    // Block policy (mutual): flag the conversation so the UI can show a clear blocked-contact
    // notice, and so only the blocker gets an Unblock action.
    const { hidden, blockedByMe } = await this.blocks.pairsFor(userId);
    return list.map((c) => {
      const shaped = shapeConv(c);
      const other = (shaped.members ?? []).filter((m: string) => m !== userId);
      const isBlocked = other.some((m: string) => hidden.has(m));
      const iBlocked = other.some((m: string) => blockedByMe.has(m));
      return { ...shaped, blocked: isBlocked, blockedByMe: iBlocked };
    });
  }

  async getById(id: string): Promise<any> {
    const conv = await this.model.findById(id).lean();
    if (!conv) throw new NotFoundException({ code: 'CONVERSATION_NOT_FOUND', message: 'Conversation not found' });
    return shapeConv(conv);
  }

  /**
   * Ids out of `requested` that actually share a conversation with `me`. Presence must never be
   * readable for arbitrary users, only for people I can already talk to.
   */
  async sharedWith(me: string, requested: string[]): Promise<string[]> {
    const ids = requested.filter((id) => id && id !== me);
    if (!ids.length) return [];
    const convs = await this.model.find({ members: me }).select('members').lean();
    const known = new Set<string>();
    for (const c of convs) for (const m of c.members ?? []) if (ids.includes(m)) known.add(m);
    return [...known];
  }
}
