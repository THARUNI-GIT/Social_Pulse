import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useNotifications } from "../context/NotificationsContext";
import { markAllRead, markRead } from "../services/notificationsService";
import { getUser } from "../services/usersService";
import { Bell } from "lucide-react";
import { EmptyState, ListSkeleton, Page } from "../components/ui";
const names = new Map(); // tiny id -> name cache (notifications carry actor ids only)
// Moderator actions use the synthetic actor "moderation", which is not a user id: looking it up
// used to fire a doomed GET /users/moderation on every render.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const useName = (id) => {
  const [n, setN] = useState(names.get(id));
  useEffect(() => {
    if (!id || !UUID_RE.test(String(id)) || names.has(id)) return;
    getUser(id).then((u) => { names.set(id, u.displayName); setN(u.displayName); }).catch(() => {});
  }, [id]);
  return n || "Someone";
};
const text = (n, who) => {
  const more = n.count > 1 && n.type === "like" ? ` and ${n.count - 1} other${n.count > 2 ? "s" : ""}` : "";
  return {
    like: `${who}${more} liked your post`,
    comment: `${who} commented: ${n.preview ?? ""}`,
    share: `${who} shared your post`,
    follow: `${who} started following you`,
    message: `${who} sent ${n.count > 1 ? `${n.count} messages` : "a message"}`,
    // Moderation outcome for the reporter: no actor name, the message already says what happened.
    moderation: n.preview ?? "Your report was reviewed.",
    // Admin alert: who reported what, so the queue can be triaged from the bell.
    report: n.preview ?? "A new report needs review.",
  }[n.type] ?? "New activity";
};
function Row({ n, onRead }) {
  const who = useName(n.actorId);
  const to = n.type === "follow"
    ? `/profile/${n.actorId}`
    : n.type === "message"
      ? "/chat"
      : n.type === "report"
        ? "/admin" // admin alert: jump straight to the moderation queue
        : n.type === "moderation" && n.targetId
          ? `/post/${n.targetId}` // dismissal keeps the post reachable; removal sends no targetId
          : "/";
  return (
    <Link to={to} onClick={() => !n.read && onRead(n)} className={`block rounded-xl px-3 py-3 text-sm ${n.read ? "bg-white" : "bg-indigo-50 font-medium"}`}>
      {n.type === "moderation" && <span className="mr-1.5" aria-hidden="true">🛡️</span>}
      {n.type === "report" && <span className="mr-1.5" aria-hidden="true">🚩</span>}
      {text(n, who)}
    </Link>
  );
}
export default function Notifications() {
  const { items, setItems, unread, setUnread, nextCursor, loadingMore, loadMore } = useNotifications(); const [first, setFirst] = useState(true);
  useEffect(() => { const t = setTimeout(() => setFirst(false), 400); return () => clearTimeout(t); }, []);
  // Viewing the list acknowledges it — including anything that arrives while it is open — so the
  // bell badge can never stick after the notifications have actually been seen.
  useEffect(() => {
    if (!unread) return;
    markAllRead()
      .then(() => { setItems((p) => p.map((x) => ({ ...x, read: true }))); setUnread(0); })
      .catch(() => {});
  }, [unread, setItems, setUnread]);
  const readAll = async () => { await markAllRead().catch(() => {}); setItems((p) => p.map((x) => ({ ...x, read: true }))); setUnread(0); };
  const readOne = async (n) => { setItems((p) => p.map((x) => (x.id === n.id ? { ...x, read: true } : x))); markRead(n.id).then((r) => setUnread(r.unread)).catch(() => {}); };
  return (
    <Page><div className="flex items-center justify-between"><h1 className="text-lg font-bold">Notifications</h1><button onClick={readAll} className="text-sm text-indigo-600">Mark all read</button></div>
      {first && !items.length ? <ListSkeleton /> : !items.length ? <EmptyState icon={Bell} title="You're all caught up" hint="Likes, comments and moderation updates will land here." /> : (
        <div className="space-y-2">
          {items.map((n) => <Row key={n.id} n={n} onRead={readOne} />)}
          {nextCursor && (
            <button onClick={loadMore} disabled={loadingMore} className="w-full rounded-xl border border-gray-200 bg-white py-2 text-sm font-medium text-gray-600 transition hover:border-indigo-200 hover:text-indigo-600 disabled:opacity-60">
              {loadingMore ? "Loading…" : "Load older notifications"}
            </button>
          )}
        </div>
      )}
    </Page>
  );
}
