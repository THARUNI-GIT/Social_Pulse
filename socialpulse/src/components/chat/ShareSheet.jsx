import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { motion, useReducedMotion } from "framer-motion";
import { Check, Search, Send, Users, X } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { listConversations } from "../../services/chatService";
import { searchUsers } from "../../services/usersService";
import { sharePostToChats } from "../../websocket/socket";
import { Avatar, ListSkeleton } from "../ui";

/**
 * In-app share sheet.
 *
 * Rendered through a portal: the feed wraps cards in a framer-motion element, and a transform
 * makes `position: fixed` resolve against that card (which is also overflow-hidden), so the sheet
 * was clipped and could not scroll. Mounting on <body> escapes both.
 *
 * Layout is a three-row flex column: fixed header, a list that owns the remaining height and
 * scrolls on its own (`min-h-0` + overflow-y-auto), and a fixed footer, so Send is always reachable.
 */
export default function ShareSheet({ open, post, onClose }) {
  const { user } = useAuth();
  const toast = useToast();
  const reduce = useReducedMotion();
  const [chats, setChats] = useState(null);
  const [people, setPeople] = useState([]);
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState(() => new Set());
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSelected(new Set()); setNote(""); setQ(""); setPeople([]);
    listConversations(user?.id).then(setChats).catch(() => setChats([]));
  }, [open, user?.id]);

  // Lock the page behind the sheet so touch scrolling only moves the list.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  // Escape closes, like any dialog.
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") onClose?.(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    const term = q.trim();
    if (!term) { setPeople([]); return; }
    let alive = true;
    const t = setTimeout(() => searchUsers(term)
      .then((r) => { if (alive) setPeople((r?.items ?? []).filter((u) => u.id !== user?.id).slice(0, 8)); })
      .catch(() => {}), 280);
    return () => { alive = false; clearTimeout(t); };
  }, [q, user?.id]);

  const toggle = (key) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const visibleChats = useMemo(() => {
    const list = (chats || []).slice(0, 30);
    const term = q.trim().toLowerCase();
    return term ? list.filter((c) => (c.name || "").toLowerCase().includes(term)) : list;
  }, [chats, q]);

  const count = selected.size;
  const close = () => { if (!sending) onClose?.(); };

  const send = async () => {
    if (!count || sending) return;
    const conversationIds = [...selected].filter((k) => k.startsWith("c:")).map((k) => k.slice(2));
    const userIds = [...selected].filter((k) => k.startsWith("u:")).map((k) => k.slice(2));
    setSending(true);
    try {
      const ack = await sharePostToChats({ postId: post.id, conversationIds, userIds, content: note.trim() || undefined });
      if (!ack?.ok) throw new Error(ack?.message || "Could not share this post");
      toast(`Sent to ${ack.sent ?? count} chat${(ack.sent ?? count) === 1 ? "" : "s"}`, "info");
      onClose?.();
    } catch (e) { toast(e.message); }
    finally { setSending(false); }
  };

  // No exit animation: AnimatePresence could keep the sheet mounted if the closing render raced
  // the send state, which left a stuck, unusable overlay. Closing now always unmounts it.
  if (!open) return null;
  const sheet = (
    <motion.div
          className="fixed inset-0 z-[100] flex items-center justify-center overflow-hidden bg-black/50 p-3 sm:p-4"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          onClick={close}
        >
          <motion.div
            role="dialog" aria-modal="true" aria-label="Share post"
            onClick={(e) => e.stopPropagation()}
            initial={reduce ? false : { y: 32, opacity: 0.5 }}
            animate={{ y: 0, opacity: 1 }}
            exit={reduce ? { opacity: 0 } : { y: 24, opacity: 0 }}
            transition={{ type: "spring", stiffness: 320, damping: 32 }}
            className="flex max-h-[85vh] w-full flex-col overflow-hidden rounded-3xl bg-white shadow-2xl sm:max-h-[min(85vh,720px)] sm:max-w-md"
          >
            <header className="flex shrink-0 items-center justify-between gap-2 border-b border-gray-100 px-4 py-3">
              <div className="min-w-0">
                <h2 className="text-sm font-bold text-gray-900">Share post</h2>
                <p className="truncate text-[11px] text-gray-500">{post.author?.displayName || "Post"} · {post.caption?.slice(0, 48) || "Shared from your feed"}</p>
              </div>
              <button onClick={close} className="icon-btn shrink-0" aria-label="Close"><X size={18} /></button>
            </header>

            <div className="shrink-0 border-b border-gray-100 px-4 py-2.5">
              <div className="relative">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  value={q} onChange={(e) => setQ(e.target.value)}
                  placeholder="Search people or chats"
                  className="w-full rounded-xl border border-gray-200 bg-gray-50 py-2 pl-9 pr-3 text-sm focus:border-indigo-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-100"
                />
              </div>
            </div>

            {/* The only scrolling region: min-h-0 lets it shrink inside the flex column. */}
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 py-2">
              {!chats ? <div className="p-3"><ListSkeleton rows={5} /></div> : (
                <>
                  {!!people.length && (
                    <>
                      <p className="sticky top-0 z-10 bg-white px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">People</p>
                      {people.map((u) => {
                        const key = `u:${u.id}`;
                        const on = selected.has(key);
                        return (
                          <button key={key} onClick={() => toggle(key)} className="flex w-full items-center gap-3 rounded-xl px-2 py-2.5 text-left transition hover:bg-gray-50">
                            <Avatar user={u} size={38} />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-semibold text-gray-900">{u.displayName || u.handle}</span>
                              <span className="block truncate text-xs text-gray-500">@{u.handle}</span>
                            </span>
                            <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full border ${on ? "border-indigo-600 bg-indigo-600 text-white" : "border-gray-300"}`}>
                              {on && <Check size={13} />}
                            </span>
                          </button>
                        );
                      })}
                    </>
                  )}
                  <p className="sticky top-0 z-10 bg-white px-2 py-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-gray-400">Recent chats</p>
                  {visibleChats.length ? visibleChats.map((c) => {
                    const key = `c:${c.conversationId}`;
                    const on = selected.has(key);
                    return (
                      <button key={key} onClick={() => toggle(key)} className="flex w-full items-center gap-3 rounded-xl px-2 py-2.5 text-left transition hover:bg-gray-50">
                        {c.type === "group" ? (
                          <span className="grid h-[38px] w-[38px] shrink-0 place-items-center rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 text-white"><Users size={16} /></span>
                        ) : (
                          <span className="relative shrink-0">
                            <Avatar user={{ displayName: c.name, avatarUrl: c.avatarUrl }} size={38} />
                            {c.online && <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-emerald-500 ring-2 ring-white" />}
                          </span>
                        )}
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold text-gray-900">{c.name}</span>
                          <span className="block truncate text-xs text-gray-500">
                            {c.type === "group" ? `${c.members?.length ?? 0} members` : c.online ? "Online" : "Direct chat"}
                          </span>
                        </span>
                        <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full border ${on ? "border-indigo-600 bg-indigo-600 text-white" : "border-gray-300"}`}>
                          {on && <Check size={13} />}
                        </span>
                      </button>
                    );
                  }) : (
                    <p className="px-3 py-8 text-center text-sm text-gray-400">
                      {q.trim() ? "No chats match that search." : "No chats yet — search for a person above."}
                    </p>
                  )}
                </>
              )}
            </div>

            <div className="shrink-0 space-y-2 border-t border-gray-100 bg-white p-3 pb-[max(12px,env(safe-area-inset-bottom))]">
              <input
                value={note} onChange={(e) => setNote(e.target.value)} maxLength={500}
                placeholder="Add a message (optional)"
                className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm focus:border-indigo-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-100"
              />
              <button
                onClick={send} disabled={!count || sending}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-500 disabled:opacity-40"
              >
                <Send size={14} /> {sending ? "Sending…" : count ? `Send to ${count}` : "Send"}
              </button>
            </div>
      </motion.div>
    </motion.div>
  );

  if (typeof document === "undefined") return null;
  return createPortal(sheet, document.body);
}
