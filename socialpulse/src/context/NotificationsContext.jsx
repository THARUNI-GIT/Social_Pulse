import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useAuth } from "./AuthContext";
import { listNotifications, unreadCount } from "../services/notificationsService";
import { connectNotifications } from "../websocket/notifySocket";
const Ctx = createContext({ unread: 0, items: [], nextCursor: null, loadingMore: false, setItems: () => {}, setUnread: () => {}, loadMore: () => {} }); export const useNotifications = () => useContext(Ctx);
const upsert = (list, n) => [n, ...list.filter((x) => x.id !== n.id)]; // grouped notifications re-arrive with the same id
export function NotificationsProvider({ children }) {
  const { user } = useAuth(); const [unread, setUnread] = useState(0); const [items, setItems] = useState([]);
  // The feed is paginated server-side; without a cursor only the first page was ever reachable.
  const [nextCursor, setNextCursor] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);
  useEffect(() => {
    if (!user) return;
    unreadCount().then((r) => setUnread(r.count)).catch(() => {});
    listNotifications().then((r) => { setItems(r.items); setNextCursor(r.nextCursor ?? null); }).catch(() => {});
    return connectNotifications({ onNew: (n) => setItems((p) => upsert(p, n)), onUnread: setUnread });
  }, [user?.id]);

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const r = await listNotifications(nextCursor);
      setItems((p) => [...p, ...r.items.filter((n) => !p.some((x) => x.id === n.id))]);
      setNextCursor(r.nextCursor ?? null);
    } catch { /* keep the current page; the button stays available */ }
    finally { setLoadingMore(false); }
  }, [nextCursor, loadingMore]);

  return <Ctx.Provider value={{ unread, items, nextCursor, loadingMore, setItems, setUnread, loadMore }}>{children}</Ctx.Provider>;
}
