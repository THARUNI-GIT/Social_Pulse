import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Check, MessageCircle, MoreHorizontal, Search, UserPlus, X } from "lucide-react";
import { displayNameOf, presenceOf, resolveProfile } from "../../services/chatService";
import { getUserId } from "../../services/session";
import { onPresence } from "../../websocket/socket";
import { Avatar, Skeleton } from "../ui";

const lastSeen = (iso) => {
  if (!iso) return "Offline";
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (!Number.isFinite(mins)) return "Offline";
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h ago`;
  return "a while ago";
};

/**
 * Group info panel: bottom sheet on phones, right-hand drawer on desktop. Only admins see admin
 * controls; the server re-checks every action. Presence is seeded from the snapshot and then kept
 * live by the same presence events the chat itself uses.
 */
export default function GroupPanel({ conversation, onClose, onChanged, onLeft, onError, api }) {
  const me = getUserId();
  const reduce = useReducedMotion();
  const members = conversation.members || [];
  const admins = conversation.admins || [];
  const isAdmin = admins.includes(me);

  const [people, setPeople] = useState({});
  const [online, setOnline] = useState({});
  const [loaded, setLoaded] = useState(false);
  const [name, setName] = useState(conversation.name || "");
  const [q, setQ] = useState("");
  const [menuFor, setMenuFor] = useState(null);
  const [addOpen, setAddOpen] = useState(false);
  const [addQ, setAddQ] = useState("");
  const [addResults, setAddResults] = useState([]);
  const [picked, setPicked] = useState(() => new Set());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoaded(false);
    Promise.all(members.map(async (id) => [id, await resolveProfile(id)])).then((pairs) => {
      if (alive) { setPeople(Object.fromEntries(pairs)); setLoaded(true); }
    });
    presenceOf(members).then((rows) => {
      if (alive) setOnline(Object.fromEntries((rows || []).map((r) => [r.userId, !!r.online])));
    }).catch(() => {});
    return () => { alive = false; };
  }, [members.join(",")]);

  // Live presence: same event stream as the chat header/rows.
  useEffect(() => onPresence(({ userId, online: isOn }) => {
    if (members.includes(userId)) setOnline((p) => ({ ...p, [userId]: isOn }));
  }), [members.join(",")]);

  useEffect(() => {
    if (!addOpen) return;
    const term = addQ.trim();
    if (!term) { setAddResults([]); return; }
    let alive = true;
    const t = setTimeout(() => api.searchUsers(term)
      .then((r) => { if (alive) setAddResults((r?.items ?? []).filter((u) => !members.includes(u.id)).slice(0, 6)); })
      .catch(() => {}), 280);
    return () => { alive = false; clearTimeout(t); };
  }, [addQ, addOpen, members.join(",")]);

  const label = (id) => displayNameOf(people[id], id);
  const onlineCount = members.filter((id) => online[id]).length;
  const sorted = useMemo(() => [...members].sort((a, b) => (online[b] ? 1 : 0) - (online[a] ? 1 : 0) || label(a).localeCompare(label(b))), [members, online, people]);
  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    return term ? sorted.filter((id) => label(id).toLowerCase().includes(term)) : sorted;
  }, [sorted, q, people]);

  const guard = async (fn) => {
    setBusy(true);
    try { await fn(); } catch (e) { onError?.(e.message); } finally { setBusy(false); }
  };
  const saveName = () => guard(async () => {
    const c = await api.renameConversation(conversation.id, name);
    onChanged?.({ name: c.name });
  });
  const makeAdmin = (id) => guard(async () => {
    const c = await api.promote(conversation.id, id);
    onChanged?.({ admins: c.admins });
  });
  const remove = (id) => guard(async () => {
    await api.removeMember(conversation.id, id);
    onChanged?.({ members: members.filter((m) => m !== id), admins: admins.filter((a) => a !== id) });
  });
  const addPicked = () => guard(async () => {
    const c = await api.addMembers(conversation.id, [...picked]);
    setPicked(new Set()); setAddQ(""); setAddResults([]); setAddOpen(false);
    onChanged?.({ members: c.members, admins: c.admins });
  });
  const leave = () => {
    if (!window.confirm("Leave this group?")) return;
    guard(async () => { await api.removeMember(conversation.id, me); onLeft?.(); });
  };

  // Portal to <body>: a transformed ancestor would otherwise make `fixed` relative to the card.
  const panel = (
    <AnimatePresence>
      <motion.div
        key="overlay"
        className="fixed inset-0 z-[85] bg-black/40 sm:bg-black/20"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={onClose}
      />
      <motion.aside
        key="panel"
        role="dialog" aria-label="Group members"
        initial={reduce ? false : { y: 40, opacity: 0.4 }}
        animate={{ y: 0, opacity: 1 }}
        exit={reduce ? { opacity: 0 } : { y: 40, opacity: 0 }}
        transition={{ type: "spring", stiffness: 340, damping: 32 }}
        className="fixed inset-x-0 bottom-0 z-[86] flex max-h-[88vh] flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:inset-y-0 sm:left-auto sm:right-0 sm:h-full sm:max-h-none sm:w-[380px] sm:rounded-none sm:border-l sm:border-gray-200"
      >
        <header className="border-b border-gray-100 px-4 py-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h2 className="truncate text-sm font-bold text-gray-900">{conversation.name || "Group"}</h2>
              <p className="text-[11px] text-gray-500">
                {members.length} member{members.length === 1 ? "" : "s"}
                <span className={onlineCount ? "ml-2 font-medium text-emerald-600" : "ml-2"}>
                  {onlineCount ? `${onlineCount} online` : "no one online"}
                </span>
              </p>
            </div>
            <button onClick={onClose} className="icon-btn" aria-label="Close"><X size={16} /></button>
          </div>
          {isAdmin && (
            <div className="mt-2 flex gap-2">
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} className="flex-1 rounded-xl border border-gray-200 px-3 py-1.5 text-xs" aria-label="Group name" />
              <button onClick={saveName} disabled={busy || !name.trim() || name === conversation.name} className="rounded-xl bg-indigo-600 px-3 text-xs font-semibold text-white disabled:opacity-40">Save</button>
            </div>
          )}
        </header>

        {members.length > 8 && (
          <div className="border-b border-gray-100 px-4 py-2">
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search members" className="w-full rounded-xl border border-gray-200 bg-gray-50 py-1.5 pl-7 pr-3 text-xs focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-100" />
            </div>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
          {!loaded ? (
            <div className="space-y-3 p-2">
              {[0, 1, 2, 3].map((i) => <div key={i} className="flex items-center gap-3"><Skeleton className="h-9 w-9 rounded-full" /><div className="flex-1 space-y-2"><Skeleton className="h-3 w-1/2" /><Skeleton className="h-2.5 w-1/3" /></div></div>)}
            </div>
          ) : shown.length ? shown.map((id) => {
            const p = people[id];
            const isMe = id === me;
            const isAdminMember = admins.includes(id);
            return (
              <div key={id} className="rounded-xl">
                <div className="flex items-center gap-2 px-2 py-2 hover:bg-gray-50">
                  <Link to={`/profile/${id}`} className="flex min-w-0 flex-1 items-center gap-2.5">
                    <span className="relative shrink-0">
                      <Avatar user={p || { displayName: label(id) }} size={36} />
                      <span className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-white ${online[id] ? "bg-emerald-500" : "bg-gray-300"}`} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate text-xs font-semibold text-gray-900">{label(id)}</span>
                        {isMe && <span className="rounded bg-gray-100 px-1 text-[9px] font-semibold text-gray-600">You</span>}
                        {isAdminMember && <span className="rounded bg-indigo-50 px-1 text-[9px] font-semibold text-indigo-600">Admin</span>}
                      </span>
                      <span className={`block text-[10px] ${online[id] ? "text-emerald-600" : "text-gray-400"}`}>
                        {online[id] ? "Online" : lastSeen(p?.lastSeenAt)}
                      </span>
                    </span>
                  </Link>
                  {!isMe && (
                    <Link to={`/chat?with=${id}`} className="icon-btn" title="Message"><MessageCircle size={14} /></Link>
                  )}
                  {isAdmin && !isMe && (
                    <button onClick={() => setMenuFor((m) => (m === id ? null : id))} className="icon-btn" title="Member options" aria-expanded={menuFor === id}><MoreHorizontal size={14} /></button>
                  )}
                </div>
                {menuFor === id && isAdmin && !isMe && (
                  <div className="mx-2 mb-1 flex gap-2 rounded-xl border border-gray-200 bg-gray-50 p-1.5">
                    {!isAdminMember && (
                      <button onClick={() => { setMenuFor(null); makeAdmin(id); }} disabled={busy} className="flex-1 rounded-lg px-2 py-1 text-[11px] font-medium text-indigo-700 hover:bg-indigo-50 disabled:opacity-50">Make admin</button>
                    )}
                    <button onClick={() => { setMenuFor(null); remove(id); }} disabled={busy} className="flex-1 rounded-lg px-2 py-1 text-[11px] font-medium text-red-600 hover:bg-red-50 disabled:opacity-50">Remove</button>
                  </div>
                )}
              </div>
            );
          }) : <p className="px-3 py-8 text-center text-xs text-gray-400">No members match.</p>}
        </div>

        {isAdmin && (
          <div className="border-t border-gray-100 px-3 py-2">
            {!addOpen ? (
              <button onClick={() => setAddOpen(true)} className="flex w-full items-center justify-center gap-2 rounded-xl border border-indigo-200 py-2 text-xs font-semibold text-indigo-700 hover:bg-indigo-50">
                <UserPlus size={14} /> Add members
              </button>
            ) : (
              <div className="space-y-2">
                <input autoFocus value={addQ} onChange={(e) => setAddQ(e.target.value)} placeholder="Search people to add" className="w-full rounded-xl border border-gray-200 px-3 py-1.5 text-xs" />
                <div className="max-h-32 space-y-1 overflow-y-auto">
                  {addResults.map((u) => {
                    const on = picked.has(u.id);
                    return (
                      <button key={u.id} onClick={() => setPicked((prev) => { const n = new Set(prev); on ? n.delete(u.id) : n.add(u.id); return n; })} className="flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left hover:bg-gray-50">
                        <Avatar user={u} size={26} />
                        <span className="min-w-0 flex-1 truncate text-[11px]">{u.displayName || u.handle}</span>
                        <span className={`grid h-4 w-4 place-items-center rounded-full border ${on ? "border-indigo-600 bg-indigo-600 text-white" : "border-gray-300"}`}>{on && <Check size={10} />}</span>
                      </button>
                    );
                  })}
                  {!addResults.length && <p className="py-2 text-center text-[10px] text-gray-400">Search above to add someone.</p>}
                </div>
                <div className="flex gap-2">
                  <button onClick={addPicked} disabled={!picked.size || busy} className="flex-1 rounded-xl bg-indigo-600 py-1.5 text-xs font-semibold text-white disabled:opacity-40">Add {picked.size || ""}</button>
                  <button onClick={() => { setAddOpen(false); setPicked(new Set()); }} className="rounded-xl border px-3 text-xs">Cancel</button>
                </div>
              </div>
            )}
          </div>
        )}

        <div className="border-t border-gray-100 p-3">
          <button onClick={leave} disabled={busy} className="w-full rounded-xl border border-red-200 py-2 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50">Leave group</button>
        </div>
      </motion.aside>
    </AnimatePresence>
  );
  return typeof document === "undefined" ? null : createPortal(panel, document.body);
}
