import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { useAuth } from "./AuthContext";
import { markChatRead, unreadChats } from "../services/chatService";
import { connect, onChatUnread } from "../websocket/socket";

const Ctx = createContext({ total: 0, byConversation: {}, refresh: () => {}, readConversation: () => {} });
export const useChatUnread = () => useContext(Ctx);

const EMPTY = { total: 0, byConversation: {} };

/**
 * Unread chat badge source. The SERVER owns the number: it is read once, pushed on every delivery
 * and after every mark-read, and re-read on a slow poll as a fallback. Nothing is incremented
 * locally, so the nav badge, the conversation rows and a second tab cannot disagree.
 */
export function ChatUnreadProvider({ children }) {
  const { user } = useAuth();
  const loc = useLocation();
  const [state, setState] = useState(EMPTY);
  const alive = useRef(true);

  const apply = useCallback((r) => {
    if (!alive.current || !r) return;
    setState({ total: r.total ?? 0, byConversation: r.byConversation ?? {} });
  }, []);

  const refresh = useCallback(async () => {
    try { apply(await unreadChats()); } catch { /* 401/offline: keep the last known value */ }
  }, [apply]);

  /** Viewing a conversation: the server marks it read and answers with the new totals. */
  const readConversation = useCallback(async (conversationId) => {
    if (!conversationId) return;
    try { apply(await markChatRead(conversationId)); } catch { /* offline: the poll catches up */ }
  }, [apply]);

  useEffect(() => {
    alive.current = true;
    if (!user) return;
    connect(); // shared singleton; the socket carries the server's unread pushes
    refresh();
    const off = onChatUnread(apply);
    const poll = setInterval(refresh, 15_000);
    return () => { alive.current = false; off(); clearInterval(poll); };
  }, [user?.id, refresh, apply]);

  // Re-check whenever the user navigates (e.g. leaving a conversation clears its count).
  useEffect(() => { if (user) refresh(); }, [loc.pathname, user?.id, refresh]);

  return <Ctx.Provider value={{ ...state, refresh, readConversation }}>{children}</Ctx.Provider>;
}
