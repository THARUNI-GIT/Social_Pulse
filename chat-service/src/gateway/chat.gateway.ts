import { OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit, SubscribeMessage, WebSocketGateway, WebSocketServer, MessageBody, ConnectedSocket } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import * as jwt from 'jsonwebtoken';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ConversationsService, shapeConv } from '../conversations/conversations.service';
import { MessagesService } from '../messages/messages.service';
import { PresenceService, PRESENCE_CHANNEL } from '../redis/presence.service';
import { RedisService } from '../redis/redis.service';
import { DeliveredDto, ConvDto, ReactDto, ReadDto, SendDto, SharePostDto, UnreactDto } from './ws.dto';
import { SuspensionsService } from '../common/suspensions.service';
import { assertChatMedia } from '../common/media';

const uroom = (id: string) => `user:${id}`; const croom = (id: string) => `conv:${id}`;
/** Auto-stop typing if the client vanishes mid-keystroke (no typing:stop ever arrives). */
const TYPING_AUTO_STOP_MS = 5_000;
const HEARTBEAT_MS = 20_000;

@WebSocketGateway({ cors: { origin: (process.env.CORS_ORIGINS ?? '').split(',').map((o) => o.trim()).filter(Boolean), credentials: true } })
export class ChatGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server: Server;
  /** conversationId:userId -> timer that force-stops typing. */
  private typingTimers = new Map<string, NodeJS.Timeout>();

  constructor(private convs: ConversationsService, private msgs: MessagesService, private presence: PresenceService, private redis: RedisService, private susp: SuspensionsService) {}

  async afterInit(server: Server) {
    // Drop connection ids left over from the previous process, so nobody is stuck "online".
    await this.presence.clearStaleConnections();
    // JWT handshake middleware: verify signature with JWT_PUBLIC_KEY, reject on failure.
    server.use((socket, next) => {
      try {
        const token = socket.handshake.auth?.token;
        if (!token) return next(new Error('UNAUTHORIZED'));
        const key = (process.env.JWT_PUBLIC_KEY ?? '').replace(/\\n/g, '\n');
        const p: any = jwt.verify(token, key, { algorithms: ['RS256', 'ES256'] });
        const uid = p.sub ?? p.userId ?? p.id;
        if (!uid) return next(new Error('UNAUTHORIZED'));
        socket.data.userId = String(uid); next();
      } catch { next(new Error('UNAUTHORIZED')); }
    });
    // Let REST handlers keep socket rooms in sync (join/leave across instances via adapter).
    this.convs.rooms = {
      join: (u, c) => this.server.in(uroom(u)).socketsJoin(croom(c)),
      leave: (u, c) => this.server.in(uroom(u)).socketsLeave(croom(c)),
      emitUpdated: (conversation) => this.server.to(croom(conversation.id)).emit('conversation:updated', { conversation }),
      // Group create/add/remove: tell the affected user directly so their socket can join/leave.
      emitToUser: (u, event, payload) => this.server.to(uroom(u)).emit(event, payload),
      // System events (member added/removed, renamed) go to whoever is still in the group only.
      emitToConversation: (c, event, payload) => this.server.to(croom(c)).emit(event, payload),
    };
    // A suspension that arrives while the user is connected must cut them off immediately, not
    // when their 15-minute access token happens to expire.
    this.susp.onSuspend((userId) => {
      this.server.in(uroom(userId)).emit('error', { code: 'ACCOUNT_SUSPENDED', message: 'This account is suspended' });
      this.server.in(uroom(userId)).disconnectSockets(true);
    });

    // Presence events: one subscription path shared by Redis and the in-memory dev fallback
    // (the fallback is an EventEmitter bus whose `publish` emits on the same object).
    const sub: any = this.redis.sub;
    const onMessage = (ch: string, raw: string) => {
      if (ch !== PRESENCE_CHANNEL) return;
      try {
        const e = JSON.parse(raw);
        this.server.local
          .to(e.conversationIds.map(croom))
          .except(uroom(e.userId))
          .emit('presence:update', { userId: e.userId, status: e.status, lastSeenAt: e.lastSeenAt });
      } catch (error) { console.error('Invalid presence event received:', error); }
    };
    sub.on('message', onMessage);
    if (typeof sub.subscribe === 'function') {
      // Subscribe only once the client is ready. Subscribing while ioredis is still connecting puts
      // the connection into subscriber mode before its ready-check INFO runs, which fails with
      // "Connection in subscriber mode" and leaves the channel with ZERO subscribers, so every
      // presence broadcast is silently dropped (snapshots still look right, live dots never move).
      const subscribe = () => { void sub.subscribe(PRESENCE_CHANNEL).catch(() => {}); };
      if (sub.status === 'ready') subscribe();
      else sub.once('ready', subscribe);
    }
  }

  async handleConnection(client: Socket) {
    const uid: string = client.data.userId;
    if (this.susp.isSuspended(uid)) {
      client.emit('error', { code: 'ACCOUNT_SUSPENDED', message: 'This account is suspended' });
      client.disconnect(true);
      return;
    }
    await client.join(uroom(uid));
    const ids = await this.convs.idsForUser(uid);
    if (ids.length) await client.join(ids.map(croom));

    const isFirstSocket = (await this.server.in(uroom(uid)).fetchSockets()).length === 1;
    await this.presence.heartbeat(uid, client.id);
    if (isFirstSocket) {
      await this.presence.publish({ userId: uid, status: 'online', lastSeenAt: new Date().toISOString(), conversationIds: ids });
    }
    // Periodic heartbeat: refreshes the registry TTL so a dead tab expires instead of staying online.
    client.data.hb = setInterval(() => this.presence.heartbeat(uid, client.id).catch(() => {}), HEARTBEAT_MS);
  }

  async handleDisconnect(client: Socket) {
    clearInterval(client.data.hb);
    const uid: string = client.data.userId; if (!uid) return;
    // Stop any typing indicator this socket owned before it disappears.
    for (const [key, t] of [...this.typingTimers.entries()]) {
      if (key.endsWith(`:${uid}`)) { clearTimeout(t); this.typingTimers.delete(key); }
    }
    const { offline } = await this.presence.clear(uid, client.id);
    const stillLocal = (await this.server.in(uroom(uid)).fetchSockets()).length > 0;
    if (offline && !stillLocal) {
      await this.presence.publish({ userId: uid, status: 'offline', lastSeenAt: await this.presence.lastSeen(uid), conversationIds: await this.convs.idsForUser(uid) });
    }
  }

  // ---------- helpers ----------
  private async v<T extends object>(cls: new () => T, data: unknown): Promise<T> {
    const o = plainToInstance(cls, data ?? {}); const errs = await validate(o as object, { whitelist: true });
    if (errs.length) throw Object.assign(new Error(errs.flatMap((e) => Object.values(e.constraints ?? {})).join('; ')), { code: 'VALIDATION_ERROR' });
    return o;
  }
  /** Runs a handler and always replies with an ack payload: Nest only sends an ack when the handler
   *  resolves to a defined value, so swallowing errors here used to leave clients hanging forever. */
  private async run<T>(client: Socket, fn: () => Promise<T | void>): Promise<{ ok: boolean } & Record<string, any>> {
    try {
      const result = await fn();
      // Handlers that return data (e.g. post:share -> { sent }) must reach the client ack.
      return { ok: true, ...(result && typeof result === 'object' ? result : {}) };
    }
    catch (e: any) {
      const err = { code: e?.response?.code ?? e?.code ?? 'ERROR', message: e?.response?.message ?? e?.message ?? 'Error' };
      client.emit('error', err);
      return { ok: false, ...err };
    }
  }

  // ---------- client -> server ----------
  @SubscribeMessage('conversation:join')
  join(@ConnectedSocket() c: Socket, @MessageBody() b: unknown) {
    return this.run(c, async () => { const d = await this.v(ConvDto, b); await this.msgs.assertMember(d.conversationId, c.data.userId); await c.join(croom(d.conversationId)); });
  }
  @SubscribeMessage('conversation:leave')
  leave(@ConnectedSocket() c: Socket, @MessageBody() b: unknown) {
    return this.run(c, async () => { const d = await this.v(ConvDto, b); await c.leave(croom(d.conversationId)); });
  }

  /** One delivery path for ordinary messages and post shares: room fan-out, then unread pushes. */
  private async deliver(uid: string, d: SendDto, opts: { post?: any } = {}) {
    const { message, conversation, recipients, excludedFromDelivery } = await this.msgs.send(uid, d, opts);
    // Members blocked by (or who blocked) the sender are excluded from this delivery, so a
    // stale socket in the same room can never receive it.
    const except = (excludedFromDelivery ?? []).map(uroom);
    const room = this.server.to(croom(d.conversationId));
    (except.length ? room.except(except) : room).emit('message:new', { message });
    if (conversation) {
      const r2 = this.server.to(croom(d.conversationId));
      (except.length ? r2.except(except) : r2).emit('conversation:updated', { conversation: shapeConv(conversation) });
    }
    // `recipients` is the list of users the message was actually delivered to. Push each one a
    // fresh server-computed unread count, so every tab renders the same authoritative number and
    // the client never has to refetch (or guess) after a delivery.
    for (const r of recipients) {
      const counts = await this.msgs.unread(r);
      this.server.to(uroom(r)).emit('conversation:unread', counts);
    }
    return message;
  }

  @SubscribeMessage('message:send')
  send(@ConnectedSocket() c: Socket, @MessageBody() b: unknown) {
    return this.run(c, async () => {
      const d = await this.v(SendDto, b); const uid = c.data.userId;
      this.susp.assertActive(uid); // a missed suspension event must not leave a live chat open
      assertChatMedia(d.mediaUrls);  // attachments must live in the platform media bucket
      await this.deliver(uid, d);
    });
  }

  /**
   * In-app post share. The post is re-read from content-service with the CALLER's identity, so
   * visibility, blocks and "I reported this" are decided server-side. The snapshot stored with the
   * message is built here, never taken from the client.
   */
  @SubscribeMessage('post:share')
  sharePost(@ConnectedSocket() c: Socket, @MessageBody() b: unknown) {
    return this.run(c, async () => {
      const d = await this.v(SharePostDto, b); const uid = c.data.userId;
      this.susp.assertActive(uid);
      const base = process.env.CONTENT_SERVICE_URL ?? 'http://content-service:3001';
      const res = await fetch(`${base}/posts/${d.postId}`, { headers: { 'x-user-id': uid } });
      if (!res.ok) throw Object.assign(new Error('This post is no longer available'), { code: 'POST_UNAVAILABLE' });
      const body: any = await res.json();
      const post = body?.data ?? body;
      if (!post?.id) throw Object.assign(new Error('This post is no longer available'), { code: 'POST_UNAVAILABLE' });
      if (post.reportedByMe) throw Object.assign(new Error('You reported this post, so it cannot be shared'), { code: 'POST_REPORTED' });
      const snapshot = {
        id: post.id,
        authorId: post.author?.id ?? post.authorId ?? null,
        authorName: post.author?.displayName || post.author?.handle || 'User',
        authorHandle: post.author?.handle || '',
        caption: String(post.caption ?? '').slice(0, 180),
        mediaUrl: post.mediaUrls?.[0] ?? null,
      };
      const targets = new Set<string>(d.conversationIds ?? []);
      for (const userId of [...new Set(d.userIds ?? [])]) {
        if (!userId || userId === uid) continue; // never a chat with yourself
        const conv: any = await this.convs.findOrCreateDirect(uid, userId);
        targets.add(String(conv.id ?? conv._id));
      }
      if (!targets.size) throw Object.assign(new Error('Pick at least one chat'), { code: 'NO_TARGETS' });
      let sent = 0;
      for (const conversationId of targets) {
        await this.msgs.assertMember(conversationId, uid);
        await this.deliver(uid, { conversationId, content: d.content?.trim() ?? '', mediaUrls: [] } as SendDto, { post: snapshot });
        sent++;
      }
      return { sent };
    });
  }

  /** Recipient tells us it really received/loaded the message -> flip sent -> delivered for the sender. */
  @SubscribeMessage('message:delivered')
  delivered(@ConnectedSocket() c: Socket, @MessageBody() b: unknown) {
    return this.run(c, async () => {
      const d = await this.v(DeliveredDto, b); const by = c.data.userId;
      const msg = await this.msgs.markDelivered(d.messageId, by);
      if (!msg) return; // already delivered/read, or the sender tried to self-mark
      this.server.to(uroom(msg.senderId)).emit('message:new', {
        message: { id: msg.id, conversationId: msg.conversationId, status: msg.status },
      });
    });
  }

  @SubscribeMessage('message:typing:start')
  typingStart(@ConnectedSocket() c: Socket, @MessageBody() b: unknown) { return this.typing(c, b, true); }
  @SubscribeMessage('message:typing:stop')
  typingStop(@ConnectedSocket() c: Socket, @MessageBody() b: unknown) { return this.typing(c, b, false); }

  /** Typing is auto-stopped after a timeout (or when the socket dies) so a stale indicator never sticks. */
  private typing(c: Socket, b: unknown, isTyping: boolean) {
    return this.run(c, async () => {
      const d = await this.v(ConvDto, b); const userId = c.data.userId;
      await this.msgs.assertMember(d.conversationId, userId);
      const key = `${d.conversationId}:${userId}`;
      const existing = this.typingTimers.get(key);
      if (existing) { clearTimeout(existing); this.typingTimers.delete(key); }

      await this.presence.setTyping(d.conversationId, userId, isTyping);
      c.to(croom(d.conversationId)).emit('message:typing', { conversationId: d.conversationId, userId, isTyping });

      if (isTyping) {
        this.typingTimers.set(key, setTimeout(async () => {
          this.typingTimers.delete(key);
          c.to(croom(d.conversationId)).emit('message:typing', { conversationId: d.conversationId, userId, isTyping: false });
        }, TYPING_AUTO_STOP_MS));
      }
    });
  }

  @SubscribeMessage('message:read')
  read(@ConnectedSocket() c: Socket, @MessageBody() b: unknown) {
    return this.run(c, async () => {
      const d = await this.v(ReadDto, b);
      const r = await this.msgs.markRead(c.data.userId, d.conversationId, d.messageId); if (!r) return;
      this.server.to(croom(r.conversationId)).emit('message:read:update', { conversationId: r.conversationId, messageId: r.messageId, userId: r.userId, readAt: r.readAt });
    });
  }

  @SubscribeMessage('message:react')
  react(@ConnectedSocket() c: Socket, @MessageBody() b: unknown) {
    return this.run(c, async () => {
      const d = await this.v(ReactDto, b); const r = await this.msgs.react(c.data.userId, d.messageId, d.emoji);
      this.server.to(croom(r.conversationId)).emit('message:reaction:update', { conversationId: r.conversationId, messageId: r.messageId, reactions: r.reactions });
    });
  }
  @SubscribeMessage('message:unreact')
  unreact(@ConnectedSocket() c: Socket, @MessageBody() b: unknown) {
    return this.run(c, async () => {
      const d = await this.v(UnreactDto, b); const r = await this.msgs.unreact(c.data.userId, d.messageId);
      this.server.to(croom(r.conversationId)).emit('message:reaction:update', { conversationId: r.conversationId, messageId: r.messageId, reactions: r.reactions });
    });
  }
}
