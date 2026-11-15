import api from "./api";
import { getUser } from "./usersService";

// Conversations only carry member ids, so resolve the other participant once and cache it.
const profiles = new Map();
export async function resolveProfile(id) {
  if (!id) return null;
  if (profiles.has(id)) return profiles.get(id);
  const p = await getUser(id).catch(() => null);
  profiles.set(id, p);
  return p;
}
export const displayNameOf = (p, id) => p?.displayName || p?.handle || (id ? `User ${id.slice(0, 6)}` : "Chat");

/**
 * Short, name-free label for a system event in the conversation list. The list has no room for
 * "Alice added Bob", and resolving every actor there would mean a profile fetch per row, so it
 * states what happened and the open thread shows who did it.
 */
export function systemPreviewLabel(system) {
  const event = typeof system === "object" && system ? system.event : null;
  switch (event) {
    case "created": return "Group created";
    case "member_added": return "Member added";
    case "member_removed": return "Member removed";
    case "member_left": return "Member left";
    case "renamed": return system?.name ? `Renamed to “${system.name}”` : "Group renamed";
    default: return "Group updated"; // legacy rows stored `system: true`
  }
}
export const initialsOf = (name) => (name || "?").trim().slice(0, 2).toUpperCase();

/**
 * Builds a PATCH-SAFE view of a message.
 *
 * Socket updates are partial: a read receipt is `{ id, conversationId, status }`. This used to
 * fill every missing field with a default, and the page merges by spreading — so receiving a read
 * receipt blanked the message text, reset its timestamp to "now" and turned system notices into
 * user bubbles. Only fields that are actually present are emitted.
 */
export function mapMessage(m) {
  if (!m) return null;
  const out = { id: m.id || m._id };
  if (m.conversationId !== undefined) out.conversationId = m.conversationId;
  if (m.senderId !== undefined) out.senderId = m.senderId;
  if (m.content !== undefined) out.text = m.content;
  else if (m.text !== undefined) out.text = m.text;
  if (Array.isArray(m.mediaUrls)) out.mediaUrls = m.mediaUrls;
  if (m.createdAt !== undefined) out.ts = new Date(m.createdAt).getTime();
  else if (m.ts !== undefined) out.ts = m.ts;
  if (m.status !== undefined) out.status = m.status;
  // 'system' messages are membership events ("A added B"), rendered as notices, not bubbles.
  if (m.type !== undefined) out.type = m.type;
  else if (m.content !== undefined) out.type = "user";
  if (m.system !== undefined) out.system = m.system || null;
  if (m.post !== undefined) out.post = m.post || null;
  if (m.reactions !== undefined) out.reactions = m.reactions;
  return out;
}

const unwrapData = (res) => res.data?.data ?? res.data;

export async function createConversation(otherUserId) {
  return unwrapData(await api.post(`/conversations/direct/${otherUserId}`));
}

// ---- groups ----
export async function createGroup(name, memberIds) {
  return unwrapData(await api.post("/conversations/group", { name, memberIds }));
}
export async function getConversation(id) {
  return unwrapData(await api.get(`/conversations/${id}`));
}
export async function listMembers(id) {
  return unwrapData(await api.get(`/conversations/${id}/members`));
}
export async function addMembers(id, memberIds) {
  return unwrapData(await api.post(`/conversations/${id}/members`, { memberIds }));
}
export async function removeMember(id, userId) {
  return unwrapData(await api.delete(`/conversations/${id}/members/${userId}`));
}
export async function promoteAdmin(id, userId) {
  return unwrapData(await api.post(`/conversations/${id}/members/${userId}/admin`));
}
export async function renameConversation(id, name) {
  return unwrapData(await api.patch(`/conversations/${id}`, { name }));
}

/** Maps a raw conversation into the shape the chat UI uses (group vs direct). */
export async function mapConversation(c, meId) {
  if (c.type === "group") {
    const members = c.members || [];
    // Stacked member avatars and "Name: message" previews need a little profile data. Both are
    // cached by resolveProfile, so this costs at most one lookup per unseen member.
    const [avatarUrls, lastSender] = await Promise.all([
      Promise.all(members.slice(0, 3).map(async (id) => (await resolveProfile(id))?.avatarUrl)).then((u) => u.filter(Boolean)),
      c.lastMessage?.senderId && !c.lastMessage?.system
        ? resolveProfile(c.lastMessage.senderId).then((p) => displayNameOf(p, c.lastMessage.senderId))
        : Promise.resolve(""),
    ]);
    return {
      id: c.id,
      conversationId: c.id,
      type: "group",
      name: c.name || "Group",
      avatarUrl: null,
      avatarUrls,
      members,
      admins: c.admins || [],
      createdBy: c.createdBy || null,
      userId: null,
      online: false,
      lastSender,
      lastMessage: c.lastMessage?.system ? systemPreviewLabel(c.lastMessage.system) : (c.lastMessage?.content || ""),
      updatedAt: c.updatedAt || c.createdAt,
    };
  }
  const members = c.members || [];
  const otherId = members.find((m) => m !== meId) ?? members[0];
  const p = await resolveProfile(otherId);
  return {
    id: c.id,
    conversationId: c.id,
    type: "direct",
    userId: otherId,
    name: displayNameOf(p, otherId),
    avatarUrl: p?.avatarUrl || null,
    members,
    online: false,
    lastMessage: c.lastMessage?.system ? systemPreviewLabel(c.lastMessage.system) : (c.lastMessage?.content || ""),
    lastSender: "",
    updatedAt: c.updatedAt || c.createdAt,
    // Server-computed block state for the caller. Dropping these made the chat look normal while
    // every send failed, so the UI could never explain why nothing was going through.
    blocked: !!c.blocked,
    blockedByMe: !!c.blockedByMe,
  };
}

export async function listConversations(meId) {
  const list = unwrapData(await api.get("/conversations")) || [];
  const rows = await Promise.all(list.map((c) => mapConversation(c, meId)));
  // The socket only tells us about people who change state *after* we connect, so every session
  // would otherwise start with everyone rendered Offline. The server scopes this snapshot to
  // people we already share a conversation with.
  const ids = [...new Set(rows.map((r) => r.userId).filter(Boolean))];
  const online = ids.length ? await presenceOf(ids).catch(() => null) : null;
  if (online) {
    const byId = new Map(online.map((p) => [p.userId, p]));
    for (const r of rows) {
      const p = r.userId ? byId.get(r.userId) : null;
      if (p) { r.online = !!p.online; r.lastSeenAt = p.lastSeenAt; }
    }
  }
  return rows;
}

/** Online/last-seen for ids the server accepts (conversation partners only). */
export async function presenceOf(userIds) {
  if (!userIds?.length) return [];
  const d = unwrapData(await api.get("/conversations/presence", { params: { userIds: userIds.join(",") } }));
  return d?.items ?? (Array.isArray(d) ? d : []);
}

/** Marks a whole conversation read server-side and returns the authoritative { total, byConversation }. */
export async function markChatRead(conversationId) {
  return unwrapData(await api.post(`/conversations/${conversationId}/read`));
}

/** Badge data for the chat navigation: { total, byConversation }. */
export async function unreadChats() {
  return unwrapData(await api.get("/conversations/unread")) || { total: 0, byConversation: {} };
}

/**
 * One page of messages, oldest-first, plus the cursor for the previous page. Without the cursor the
 * UI could only ever show the newest page and older history was unreachable.
 */
export async function listMessages(conversationId, cursor) {
  const data = unwrapData(await api.get(`/conversations/${conversationId}/messages`, { params: cursor ? { cursor } : undefined }));
  const items = data?.items || (Array.isArray(data) ? data : []);
  return {
    items: items.map(mapMessage).sort((a, b) => a.ts - b.ts),
    nextCursor: data?.nextCursor ?? null,
  };
}
