import { io } from "socket.io-client";
import { getToken, getUserId } from "../services/session";
import { mapMessage } from "../services/chatService";

let socket = null;
const subs = { message: new Set(), typing: new Set(), presence: new Set(), conversation: new Set(), unread: new Set() };
const sub = (set) => (fn) => { set.add(fn); return () => set.delete(fn); };
const fire = (set, v) => set.forEach((fn) => fn(v));

// Swap for: io(VITE_CHAT_URL, { auth: { token } })
export function connect() {
  if (socket) return socket;
  socket = io(import.meta.env.VITE_CHAT_URL, { auth: (cb) => cb({ token: getToken() }) });

  socket.on("message:new", ({ message }) => fire(subs.message, mapMessage(message)));
  // Partial updates: same id + changed fields. The page upserts (merges) by id.
  socket.on("message:read:update", ({ conversationId, messageId, userId }) => {
    if (userId !== getUserId()) fire(subs.message, { id: messageId, conversationId, status: "read" });
  });
  socket.on("message:delivered", ({ conversationId, messageId }) => {
    fire(subs.message, { id: messageId, conversationId, status: "delivered" });
  });
  socket.on("message:reaction:update", ({ conversationId, messageId, reactions }) => fire(subs.message, { id: messageId, conversationId, reactions }));
  socket.on("message:typing", ({ conversationId, userId, isTyping }) => fire(subs.typing, { conversationId, from: userId, typing: isTyping }));
  socket.on("presence:update", ({ userId, status, lastSeenAt }) => fire(subs.presence, { userId, online: status === "online", lastSeenAt }));
  // Server-authoritative unread totals: pushed on delivery and after a mark-read.
  socket.on("conversation:unread", ({ total, byConversation }) => fire(subs.unread, { total, byConversation }));
  // Group lifecycle: the server joins/leaves our socket room itself and tells us here.
  socket.on("conversation:created", ({ conversation }) => fire(subs.conversation, { type: "created", conversation }));
  socket.on("conversation:updated", ({ conversation }) => fire(subs.conversation, { type: "updated", conversation }));
  socket.on("conversation:removed", ({ conversationId }) => fire(subs.conversation, { type: "removed", conversationId }));
  return socket;
}
export function disconnect() { socket?.disconnect(); socket = null; }
export function send({ conversationId, text, mediaUrls }) {
  socket?.emit("message:send", {
    conversationId,
    type: "text",
    content: text || "",
    ...(mediaUrls?.length ? { mediaUrls } : {}),
  });
}
export const onMessage = sub(subs.message);
export const onTyping = sub(subs.typing);
export const onPresence = sub(subs.presence);
export const onConversation = sub(subs.conversation);
export const onChatUnread = sub(subs.unread);
export function joinConversation(conversationId) { socket?.emit("conversation:join", { conversationId }); }
export function emitTyping(conversationId, isTyping) {
  socket?.emit(isTyping ? "message:typing:start" : "message:typing:stop", { conversationId });
}
/**
 * Reconnect with the CURRENT session token. The socket caches the token it connected with, so a
 * logout/login in the same tab would otherwise keep the previous user's identity on the wire.
 */
export function resetSocket() {
  if (!socket) return;
  socket.removeAllListeners();
  socket.disconnect();
  socket = null;
}
export function markRead(conversationId, messageId) { socket?.emit("message:read", { conversationId, messageId }); }
/** Recipient acknowledges receipt: the sender's tick goes from sent (✓) to delivered (✓✓). */
export function markDelivered(messageId) { socket?.emit("message:delivered", { messageId }); }
/** In-app share: server re-validates the post and creates one message per target conversation. */
export function sharePostToChats(payload) {
  return new Promise((resolve) => {
    if (!socket) return resolve({ ok: false, message: "Not connected" });
    socket.timeout(8000).emit("post:share", payload, (err, ack) => resolve(err ? { ok: false, message: "Share timed out" } : ack));
  });
}
export function react(messageId, emoji) { socket?.emit("message:react", { messageId, emoji }); }
export function unreact(messageId) { socket?.emit("message:unreact", { messageId }); }
