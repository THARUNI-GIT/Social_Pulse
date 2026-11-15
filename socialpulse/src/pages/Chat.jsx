import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import AppLayout from "../layouts/AppLayout";
import ConversationList from "../components/chat/ConversationList";
import ChatWindow from "../components/chat/ChatWindow";
import MessageInput from "../components/chat/MessageInput";
import GroupPanel from "../components/chat/GroupPanel";
import {
  addMembers, createConversation, createGroup, displayNameOf, listConversations, listMessages,
  mapConversation, presenceOf, promoteAdmin, removeMember, renameConversation, resolveProfile,
} from "../services/chatService";
import { searchUsers, block as setBlock } from "../services/usersService";
import { getUserId } from "../services/session";
import { connect, emitTyping, markDelivered, markRead, onConversation, onMessage, onPresence, onTyping, react, send, unreact } from "../websocket/socket";
import { useChatUnread } from "../context/ChatUnreadContext";
import { ArrowLeft, Search, UserPlus, Users } from "lucide-react";

// Merge a full or partial message into the list by id (partials for unknown ids are ignored).
const upsert = (list, m) => {
  const i = list.findIndex((x) => x.id === m.id);
  if (i === -1) return m.text !== undefined ? [...list, m].sort((a, b) => a.ts - b.ts) : list;
  const next = list.slice(); next[i] = { ...list[i], ...m }; return next;
};

const BLOCKED = /blocked/i;
// A conversation is only acknowledged while the user can actually see it: a message that arrives
// in a hidden or unfocused tab must stay unread until the tab is visible AND focused again.
const isViewing = () => typeof document !== "undefined" && document.visibilityState === "visible" && document.hasFocus();

// Typing is transient: it never enters the message store and expires locally, so a sender whose
// socket dies before emitting typing:stop cannot leave a permanent "typing…" on screen.
const TYPING_TTL_MS = 6000;
const withoutTyper = (map, conversationId, userId) => {
  const current = map[conversationId];
  if (!current?.[userId]) return map;
  const next = { ...current }; delete next[userId];
  return { ...map, [conversationId]: next };
};

export default function Chat() {
  const [params] = useSearchParams();
  const [users, setUsers] = useState([]);
  const [active, setActive] = useState(null);
  const [messages, setMessages] = useState([]);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [results, setResults] = useState([]);
  const [names, setNames] = useState({});
  const [showGroup, setShowGroup] = useState(false);
  const [newGroup, setNewGroup] = useState(null); // { name, selected: Set }
  const [typing, setTyping] = useState({}); // conversationId -> { userId: true }
  const [olderCursor, setOlderCursor] = useState(null); // cursor for the previous page of messages
  const [loadingOlder, setLoadingOlder] = useState(false);
  const activeRef = useRef(null);
  const seen = useRef(new Set());
  const typingTimers = useRef(new Map());
  const viewingRef = useRef(isViewing());
  const { byConversation: unreadByConversation, readConversation } = useChatUnread();
  activeRef.current = active;

  const loadUsers = useCallback(() => listConversations(getUserId()).then(setUsers).catch((e) => setError(e.message)), []);

  // Debounced people search so you start a chat (or invite to a group) by name/handle.
  useEffect(() => {
    const term = q.trim();
    if (!term) { setResults([]); return; }
    let alive = true;
    const t = setTimeout(() => {
      searchUsers(term)
        .then((r) => { if (alive) setResults((r?.items ?? (Array.isArray(r) ? r : [])).slice(0, 6)); })
        .catch(() => { if (alive) setResults([]); });
    }, 300);
    return () => { alive = false; clearTimeout(t); };
  }, [q]);

  useEffect(() => {
    loadUsers(); connect();
    const offs = [
      onMessage((m) => {
        const active = activeRef.current;
        // Partial updates (reaction / read receipts) may omit conversationId: apply them to the
        // open thread and let upsert ignore ids that are not in this conversation.
        if (active && (!m.conversationId || m.conversationId === active.conversationId)) setMessages((p) => upsert(p, m));
        if (m.text !== undefined) {
          loadUsers();
          // Acknowledge receipt so the sender's tick becomes delivered (✓✓) before it is read.
          if (m.senderId && m.senderId !== getUserId()) markDelivered(m.id);
          // The thread is open AND on screen: acknowledge server-side, which also zeroes its badge.
          // While the tab is hidden the message stays unread until the tab is viewed again.
          if (active && m.conversationId === active.conversationId && viewingRef.current) readConversation(active.conversationId);
        }
      }),

      onConversation((e) => {
        if (e.type === "removed") { setUsers((p) => p.filter((u) => u.id !== e.conversationId)); if (activeRef.current?.id === e.conversationId) setActive(null); }
        else loadUsers();
      }),

      // Someone in a conversation started/stopped typing. The server also auto-stops after a few
      // seconds; the local TTL covers a socket that disappears without sending the stop.
      onTyping(({ conversationId, from, typing: isTyping }) => {
        if (!conversationId || !from || from === getUserId()) return;
        const key = `${conversationId}:${from}`;
        const pending = typingTimers.current.get(key);
        if (pending) { clearTimeout(pending); typingTimers.current.delete(key); }
        if (isTyping) {
          typingTimers.current.set(key, setTimeout(() => {
            typingTimers.current.delete(key);
            setTyping((p) => withoutTyper(p, conversationId, from));
          }, TYPING_TTL_MS));
        }
        setTyping((p) => {
          const current = { ...(p[conversationId] || {}) };
          if (isTyping) current[from] = true; else delete current[from];
          return { ...p, [conversationId]: current };
        });
      }),

      // Online / offline transitions arrive as they happen; the row keeps last-seen so the header
      // can say "Last seen 5m ago" instead of a bare "Offline".
      onPresence(({ userId, online, lastSeenAt }) => {
        if (!userId) return;
        setUsers((p) => p.map((u) => (u.userId === userId ? { ...u, online, lastSeenAt: lastSeenAt || u.lastSeenAt } : u)));
        setActive((a) => (a?.userId === userId ? { ...a, online, lastSeenAt: lastSeenAt || a.lastSeenAt } : a));
      }),
    ];
    return () => {
      offs.forEach((off) => off());
      typingTimers.current.forEach((t) => clearTimeout(t));
      typingTimers.current.clear();
    };
  }, [loadUsers, readConversation]);

  /**
   * Read receipts only apply to a conversation the user can actually see. When the tab becomes
   * visible AND focused again, the open conversation is acknowledged in one server call, which also
   * clears its badge (and any message that arrived while it was hidden).
   */
  useEffect(() => {
    const sync = () => {
      const nowViewing = isViewing();
      const becameViewing = nowViewing && !viewingRef.current;
      viewingRef.current = nowViewing;
      if (becameViewing && activeRef.current?.conversationId) readConversation(activeRef.current.conversationId);
    };
    document.addEventListener("visibilitychange", sync);
    window.addEventListener("focus", sync);
    window.addEventListener("blur", sync);
    return () => {
      document.removeEventListener("visibilitychange", sync);
      window.removeEventListener("focus", sync);
      window.removeEventListener("blur", sync);
    };
  }, [readConversation]);

  /**
   * Presence is event-driven, so a tab that dies without a clean disconnect (crash, sleep, network
   * drop) never publishes `offline` and the peer's dot stays green forever. Re-reading the scoped
   * snapshot every 20s repairs that, and also heals any event missed across a reconnect.
   */
  const presenceIds = [...new Set(users.map((u) => u.userId).filter(Boolean))].join(",");
  useEffect(() => {
    if (!presenceIds) return;
    let alive = true;
    const tick = () => presenceOf(presenceIds.split(","))
      .then((rows) => {
        if (!alive || !rows?.length) return;
        const byId = new Map(rows.map((r) => [r.userId, r]));
        setUsers((p) => p.map((u) => {
          const r = u.userId ? byId.get(u.userId) : null;
          return r ? { ...u, online: !!r.online, lastSeenAt: r.lastSeenAt } : u;
        }));
        setActive((a) => {
          const r = a?.userId ? byId.get(a.userId) : null;
          return r ? { ...a, online: !!r.online, lastSeenAt: r.lastSeenAt } : a;
        });
      })
      .catch(() => {});
    tick();
    const t = setInterval(tick, 20_000);
    return () => { alive = false; clearInterval(t); };
  }, [presenceIds]);

  const select = async (u) => {
    setActive(u); setMessages([]); setError(""); setShowGroup(false);
    // Refresh this partner's status immediately: the presence snapshot is only taken on load.
    if (u?.userId) {
      presenceOf([u.userId])
        .then(([p]) => { if (p) setActive((a) => (a?.id === u.id ? { ...a, online: !!p.online, lastSeenAt: p.lastSeenAt } : a)); })
        .catch(() => {});
    }
    setOlderCursor(null);
    try {
      const page = await listMessages(u.id);
      setMessages(page.items);
      setOlderCursor(page.nextCursor);
      // Loading the thread also counts as delivery for anything not yet acknowledged.
      page.items.filter((m) => m.senderId && m.senderId !== getUserId() && m.status === "sent").forEach((m) => markDelivered(m.id));
      // Opening the conversation acknowledges all of it — but only if it is actually on screen.
      if (viewingRef.current) readConversation(u.conversationId);
    } catch (e) { setError(e.message); }
  };

  /** Older history: the REST list is paginated, and the UI used to have no way to ask for more. */
  const loadOlder = async () => {
    if (!active || !olderCursor || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const page = await listMessages(active.conversationId, olderCursor);
      setMessages((prev) => {
        const known = new Set(prev.map((m) => m.id));
        return [...page.items.filter((m) => !known.has(m.id)), ...prev];
      });
      setOlderCursor(page.nextCursor);
    } catch (e) { setError(e.message); }
    finally { setLoadingOlder(false); }
  };

  // Resolve display names for everyone a group bubble, system notice, or typing indicator can
  // mention. `resolved` stops repeat lookups.
  const resolved = useRef(new Set());
  const activeTypers = active ? Object.keys(typing[active.conversationId] || {}) : [];
  useEffect(() => {
    if (active?.type !== "group") return;
    const wanted = new Set(activeTypers);
    for (const m of messages) {
      if (m.senderId) wanted.add(m.senderId);
      if (m.system?.actorId) wanted.add(m.system.actorId);
      if (m.system?.targetId) wanted.add(m.system.targetId);
    }
    const missing = [...wanted].filter((id) => id && !resolved.current.has(id));
    if (!missing.length) return;
    missing.forEach((id) => resolved.current.add(id));
    let alive = true;
    Promise.all(missing.map(async (id) => [id, displayNameOf(await resolveProfile(id), id)]))
      .then((entries) => { if (alive) setNames((p) => ({ ...p, ...Object.fromEntries(entries) })); });
    return () => { alive = false; };
  }, [active?.id, active?.type, messages, typing, active?.conversationId]);


  const start = async (userId) => {
    if (!userId) return;
    try {
      const c = await createConversation(userId);
      setQ(""); setResults([]);
      await loadUsers();
      const p = await resolveProfile(userId);
      select({ id: c.id, conversationId: c.id, type: "direct", userId, name: displayNameOf(p, userId), avatarUrl: p?.avatarUrl || null, online: false });
    } catch (e) { setError(BLOCKED.test(e.message) ? "You can't start a chat with this user because one of you blocked the other." : e.message); }
  };

  // Deep link from a profile's "Message" button: /chat?with=<userId>
  const withId = params.get("with");
  useEffect(() => {
    if (withId) start(withId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [withId]);

  const makeGroup = async () => {
    if (!newGroup) return;
    try {
      const c = await createGroup(newGroup.name, [...newGroup.selected]);
      setNewGroup(null);
      await loadUsers();
      select(mapGroupEntry(c));
    } catch (e) { setError(e.message); }
  };

  const mapGroupEntry = (c) => ({ id: c.id, conversationId: c.id, type: "group", name: c.name, members: c.members, admins: c.admins, createdBy: c.createdBy, userId: null, avatarUrl: null, online: false });

  // Per-message receipts only: they drive the sender's ✓✓ ticks. The badge is owned by the
  // conversation-level mark-read above, so no count is refreshed from here.
  const onSeen = useCallback((m) => {
    if (!viewingRef.current || seen.current.has(m.id) || !activeRef.current) return;
    seen.current.add(m.id); markRead(activeRef.current.conversationId, m.id);
  }, []);

  // Unblock only from the settings list or here; both go through the same backend relationship.
  const unblockUser = useCallback(async (userId) => {
    try {
      await setBlock(userId, false);
      // Clear the cached profile so the next load re-reads the (now unblocked) state.
      setUsers((p) => p.map((u) => (u.userId === userId ? { ...u, blocked: false, blockedByMe: false } : u)));
      setError("");
    } catch (e) { setError(e.message); }
  }, []);

  // Toggle: tapping the emoji you already picked removes your reaction.
  const toggleReaction = useCallback((messageId, emoji) => {
    const msg = messages.find((m) => m.id === messageId);
    const mine = msg?.reactions?.find((r) => r.userId === getUserId());
    if (mine?.emoji === emoji) unreact(messageId); else react(messageId, emoji);
  }, [messages]);

  // Blocked state is server-persisted, so it must survive a refresh: derive it from the
  // conversation row, not from a one-shot error string.
  const activeUser = users.find((u) => u.id === active?.id) || active;
  const typingIds = new Set(Object.entries(typing).filter(([, ids]) => Object.keys(ids).length).map(([id]) => id));
  const blockedNotice = activeUser?.blocked
    ? (activeUser.blockedByMe
      ? `You blocked ${activeUser.name || "this user"}. Messaging is disabled until you unblock them.`
      : `${activeUser.name || "This user"} has blocked you, so messaging is disabled.`)
    : "";
  const notice = blockedNotice || (/blocked/i.test(error) ? error : "");

  return (
    <AppLayout>
      <div className="flex h-[70vh] rounded-2xl border bg-white overflow-hidden">
        <aside className={`${active ? 'hidden md:flex' : 'flex'} w-full md:w-72 border-r flex-col`}>
          <div className="p-3 border-b space-y-2">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search people to chat with"
                  className="w-full rounded-lg border border-gray-200 bg-gray-50 pl-7 pr-2 py-1.5 text-xs focus:border-indigo-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-100"
                />
              </div>
              <button onClick={() => setNewGroup({ name: "", selected: new Set() })} className="rounded-lg border px-2 text-xs font-medium text-indigo-600 hover:bg-indigo-50" title="New group">
                <Users size={14} />
              </button>
            </div>

            {newGroup && (
              <div className="rounded-lg border border-indigo-200 bg-indigo-50/60 p-2 space-y-2">
                <input value={newGroup.name} onChange={(e) => setNewGroup({ ...newGroup, name: e.target.value })} placeholder="Group name" className="w-full rounded-lg border px-2 py-1.5 text-xs" />
                <div className="max-h-32 overflow-y-auto space-y-1">
                  {results.map((u) => (
                    <label key={u.id} className="flex items-center gap-2 text-xs">
                      <input type="checkbox" checked={newGroup.selected.has(u.id)} onChange={(e) => {
                        const s = new Set(newGroup.selected); e.target.checked ? s.add(u.id) : s.delete(u.id); setNewGroup({ ...newGroup, selected: s });
                      }} />
                      <span>{u.displayName || u.handle} <span className="text-gray-400">@{u.handle}</span></span>
                    </label>
                  ))}
                  {!results.length && <p className="text-[10px] text-gray-500">Search above to add members…</p>}
                </div>
                <div className="flex gap-2">
                  <button onClick={makeGroup} disabled={!newGroup.name.trim() || !newGroup.selected.size} className="flex-1 rounded-lg bg-indigo-600 py-1.5 text-xs font-medium text-white disabled:opacity-50">Create group</button>
                  <button onClick={() => setNewGroup(null)} className="rounded-lg border px-2 text-xs">Cancel</button>
                </div>
              </div>
            )}

            {!newGroup && results.length > 0 && (
              <div className="rounded-lg border border-gray-100 divide-y overflow-hidden shadow-sm">
                {results.map((u) => (
                  <button key={u.id} onClick={() => start(u.id)} className="w-full flex items-center gap-2 px-2.5 py-2 text-left hover:bg-indigo-50 transition">
                    <span className="w-6 h-6 rounded-full bg-indigo-600 text-white flex items-center justify-center text-[10px] font-semibold shrink-0">
                      {(u.displayName || u.handle || "?").slice(0, 2).toUpperCase()}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs font-semibold text-gray-900 truncate">{u.displayName || u.handle}</span>
                      <span className="block text-[10px] text-gray-500 truncate">@{u.handle}</span>
                    </span>
                    <UserPlus size={13} className="text-indigo-500 shrink-0" />
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="flex-1 overflow-y-auto"><ConversationList users={users} activeId={active?.id} onSelect={select} typingIds={typingIds} unreadById={unreadByConversation} /></div>
        </aside>
        <section className={`${active ? 'flex' : 'hidden md:flex'} flex-col flex-1 min-w-0`}>
          {active ? (
            <div className="flex flex-col h-full">
              <div className="md:hidden border-b p-2">
                <button onClick={() => setActive(null)} className="flex items-center text-sm text-indigo-600">
                  <ArrowLeft size={16} className="mr-1" /> Back
                </button>
              </div>
              <ChatWindow
                user={activeUser}
                messages={messages}
                onSeen={onSeen}
                onReact={toggleReaction}
                nameOf={(id) => names[id]}
                notice={notice}
                typingUserIds={activeTypers}
                onLoadOlder={loadOlder}
                hasOlder={!!olderCursor}
                loadingOlder={loadingOlder}
                online={!!activeUser?.online}
                lastSeenAt={activeUser?.lastSeenAt}
                blocked={!!blockedNotice}
                onUnblock={activeUser?.blockedByMe && activeUser?.userId ? () => unblockUser(activeUser.userId) : undefined}
                headerAction={active.type === "group" && (
                  <button onClick={() => setShowGroup((v) => !v)} className="icon-btn" title="Group members"><Users size={16} /></button>
                )}
              >
                <MessageInput
                  key={active.conversationId}
                  onTyping={(isTyping) => emitTyping(active.conversationId, isTyping)}
                  onSend={(text, mediaUrls) => send({ conversationId: active.conversationId, text, mediaUrls })}
                />
              </ChatWindow>
              {(active) && (active.type === "group") && showGroup && (
                <GroupPanel
                  conversation={active}
                  onClose={() => setShowGroup(false)}
                  onChanged={(c) => { setActive((a) => (c ? { ...a, ...c } : a)); loadUsers(); }}
                  onLeft={() => { setActive(null); setShowGroup(false); loadUsers(); }}
                  onError={setError}
                  api={{ addMembers, removeMember, promoteAdmin, renameConversation, searchUsers }}
                />
              )}
            </div>
          ) : <div className="h-full flex items-center justify-center text-sm text-gray-400">Select a conversation</div>}
          {error && !notice && <p className="px-4 py-2 text-xs text-red-600">{error}</p>}
        </section>
      </div>
    </AppLayout>
  );
}
