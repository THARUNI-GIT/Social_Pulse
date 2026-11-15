import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Check, CheckCheck, SmilePlus } from "lucide-react";
import { getUserId } from "../../services/session";
import { isVideoUrl } from "../../adapters/postAdapter";
import { getPost } from "../../services/postsService";
import { SmartImage } from "../ui";

const REACTIONS = ["👍", "❤️", "😂", "🎉", "😮", "😢"];

/**
 * Renders a membership event with real names. Values come from the server as ids, so they are
 * looked up through `nameOf` (which falls back to a short id) and React escapes them on render.
 */
function systemText(m, nameOf) {
  const s = m.system;
  if (!s) return m.text;
  const who = (id) => (id ? nameOf?.(id) || `user ${String(id).slice(0, 6)}` : "someone");
  switch (s.event) {
    case "created": return `${who(s.actorId)} created the group`;
    case "member_added": return `${who(s.actorId)} added ${who(s.targetId)}`;
    case "member_removed": return `${who(s.actorId)} removed ${who(s.targetId)}`;
    case "member_left": return `${who(s.actorId)} left the group`;
    case "renamed": return `${who(s.actorId)} renamed the group to “${s.name ?? ""}”`;
    default: return m.text;
  }
}

/**
 * Compact shared-post card. The message stores a snapshot, but the post may have been removed or
 * made private since: a cheap visibility probe swaps the card for a plain notice instead of a
 * dead link.
 */
function SharedPost({ post }) {
  const [gone, setGone] = useState(false);
  useEffect(() => {
    let alive = true;
    getPost(post.id).then(() => { if (alive) setGone(false); }).catch(() => { if (alive) setGone(true); });
    return () => { alive = false; };
  }, [post.id]);
  if (gone) return <p className="my-1 rounded-xl border border-dashed border-gray-200 px-3 py-2 text-[11px] text-gray-500">This post is no longer available</p>;
  return (
    <Link to={`/post/${post.id}`} className="my-1 block overflow-hidden rounded-xl border border-gray-200 bg-white transition hover:border-indigo-200">
      {post.mediaUrl && <SmartImage src={post.mediaUrl} className="h-28 w-full" imgClassName="h-28 w-full object-cover" />}
      <span className="block px-2.5 py-2">
        <span className="block text-[10px] font-semibold text-indigo-600">{post.authorName}{post.authorHandle ? ` · @${post.authorHandle}` : ""}</span>
        <span className="mt-0.5 block text-[11px] leading-snug text-gray-700 line-clamp-2">{post.caption || "Shared post"}</span>
      </span>
    </Link>
  );
}

/** "Last seen 5m ago" without pulling in a date library. */
function lastSeenText(iso) {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "";
  const mins = Math.floor((Date.now() - t) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h ago`;
  return new Date(iso).toLocaleDateString();
}

export default function ChatWindow({ user, messages = [], onSeen, onReact, notice, nameOf, headerAction, blocked = false, onUnblock, typingUserIds = [], online = false, lastSeenAt, onLoadOlder, hasOlder = false, loadingOlder = false, children }) {
  const isGroup = user?.type === "group";
  const currentUserId = getUserId();
  const bottomRef = useRef(null);
  const scrollRef = useRef(null);
  const [pickerFor, setPickerFor] = useState(null);
  // Only follow new messages while the reader is already at the bottom; otherwise show a pill.
  const [atBottom, setAtBottom] = useState(true);

  // A group can have several people typing at once; a direct chat only ever one.
  const typers = typingUserIds.slice(0, 2).map((id) => (isGroup ? nameOf?.(id) || "Someone" : user?.name || "Someone"));
  const typingLabel = typers.length
    ? `${typers.join(", ")}${typingUserIds.length > 2 ? ` +${typingUserIds.length - 2}` : ""} ${typers.length > 1 ? "are" : "is"} typing…`
    : "";
  const statusText = isGroup
    ? `${user?.members?.length ?? 0} members`
    : online ? "Online" : lastSeenAt ? `Last seen ${lastSeenText(lastSeenAt)}` : "Offline";

  useEffect(() => {
    if (atBottom) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, typingLabel, atBottom]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 80);
  };
  const jump = () => { setAtBottom(true); bottomRef.current?.scrollIntoView({ behavior: "smooth" }); };

  useEffect(() => {
    messages.forEach((m) => {
      if (m.type === "system") return; // membership notices have no read receipt
      if (m.senderId !== currentUserId) onSeen?.(m);
    });
  }, [messages, currentUserId, onSeen]);

  const initials = (user?.name || "U").slice(0, 2).toUpperCase();

  return (
    <div className="flex flex-col h-full bg-gray-50/50">
      {/* Header - for a direct chat the avatar and name open the participant's profile. */}
      <div className="p-3 border-b bg-white flex items-center justify-between gap-2">
        <Link to={!isGroup && user?.userId ? `/profile/${user.userId}` : "#"} className={`flex items-center gap-3 group ${isGroup ? "pointer-events-none" : ""}`}>
          <span className="relative">
            <span className="w-8 h-8 rounded-full bg-indigo-600 text-white flex items-center justify-center font-semibold text-xs overflow-hidden">
              {user?.avatarUrl ? <img src={user.avatarUrl} alt="" className="h-8 w-8 rounded-full object-cover" /> : initials}
            </span>
            {!isGroup && online && (
              <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-emerald-500 ring-2 ring-white" aria-label="Online" />
            )}
          </span>
          <span>
            <h3 className="text-xs font-bold text-gray-900 group-hover:text-indigo-600">{user?.name || user?.id}</h3>
            <p className={`text-[10px] ${typingLabel ? "font-medium text-indigo-600" : online && !isGroup ? "text-emerald-600" : "text-gray-500"}`}>
              {typingLabel || statusText}
            </p>
          </span>
        </Link>
        {headerAction}
      </div>

      {/* Message Feed */}
      <div ref={scrollRef} onScroll={onScroll} className="relative flex-1 overflow-y-auto p-4 space-y-3">
        {!atBottom && (
          <button
            onClick={jump}
            className="sticky bottom-2 z-10 mx-auto flex items-center gap-1 rounded-full bg-gray-900 px-3 py-1.5 text-[11px] font-semibold text-white shadow-lg"
          >
            Jump to latest
          </button>
        )}
        {hasOlder && (
          <div className="flex justify-center pb-1">
            <button
              onClick={onLoadOlder}
              disabled={loadingOlder}
              className="rounded-full border border-gray-200 bg-white px-3 py-1 text-[11px] font-medium text-gray-600 transition hover:border-indigo-200 hover:text-indigo-600 disabled:opacity-60"
            >
              {loadingOlder ? "Loading…" : "Load older messages"}
            </button>
          </div>
        )}
        {messages.map((m, i) => {
          // Membership events are centred notices, never a bubble with ticks or reactions.
          if (m.type === "system") {
            return (
              <div key={m.id} className="flex justify-center py-0.5">
                <span className="max-w-[85%] rounded-full bg-gray-200/70 px-3 py-1 text-center text-[11px] text-gray-600">
                  {systemText(m, nameOf)}
                </span>
              </div>
            );
          }
          const isMe = m.senderId === currentUserId;
          const mine = m.reactions?.find((r) => r.userId === currentUserId);
          const prev = messages[i - 1];
          const dayChange = !prev || new Date(prev.ts).toDateString() !== new Date(m.ts).toDateString();
          // Group bubbles carry a name/avatar only at the start of a sender's run.
          const showName = isGroup && !isMe && prev?.senderId !== m.senderId;
          return (
            <div key={m.id} className={`flex flex-col ${isMe ? "items-end" : "items-start"}`}>
              {dayChange && (
                <p className="mx-auto mb-1 mt-2 w-fit rounded-full bg-gray-200/70 px-2.5 py-0.5 text-[10px] font-medium text-gray-500">
                  {new Date(m.ts).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}
                </p>
              )}
              <div className={`group flex items-center gap-1 ${isMe ? "flex-row-reverse" : ""}`}>
                {showName && (
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-indigo-100 text-[10px] font-semibold text-indigo-700">
                    {(nameOf?.(m.senderId) || "M").slice(0, 1).toUpperCase()}
                  </span>
                )}
                <div
                  className={`max-w-[75%] rounded-2xl px-3 py-2 text-xs shadow-sm ${
                    isMe ? "bg-indigo-600 text-white rounded-br-none" : "bg-white text-gray-900 border rounded-bl-none"
                  }`}
                >
                  {showName && <p className="mb-0.5 text-[10px] font-semibold text-indigo-600">{nameOf?.(m.senderId) || "Member"}</p>}
                  {m.post && <SharedPost post={m.post} />}
                  {!!m.mediaUrls?.length && (
                    <div className="mb-1 space-y-1">
                      {m.mediaUrls.map((url) => (isVideoUrl(url)
                        ? <video key={url} src={url} controls preload="metadata" className="max-h-64 w-full rounded-lg bg-black object-contain" />
                        : <img key={url} src={url} alt="" loading="lazy" className="max-h-64 w-full rounded-lg object-cover" />))}
                    </div>
                  )}
                  {m.text ? <p>{m.text}</p> : null}
                  {!!m.reactions?.length && (
                    <div className={`flex gap-1 mt-1 pt-1 border-t ${isMe ? "border-white/20" : "border-gray-100"}`}>
                      {m.reactions.map((r, i) => (
                        <span key={i} className={`rounded-full px-1 text-[11px] ${r.userId === currentUserId ? "bg-white/25" : ""}`} title={r.userId}>{r.emoji}</span>
                      ))}
                    </div>
                  )}
                  <div className={`flex items-center justify-end gap-1 mt-0.5 text-[9px] ${isMe ? "text-indigo-200" : "text-gray-400"}`}>
                    <span>{new Date(m.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                    {isMe && (
                      <span title={m.status === "read" ? "Seen" : m.status === "delivered" ? "Delivered" : "Sent"}>
                        {(m.status === "read" && <CheckCheck size={12} className="text-sky-300" />) ||
                          (m.status === "delivered" && <CheckCheck size={12} />) || <Check size={12} />}
                      </span>
                    )}
                  </div>
                </div>
                {onReact && (
                  <button
                    onClick={() => setPickerFor((p) => (p === m.id ? null : m.id))}
                    className={`opacity-0 transition group-hover:opacity-100 ${pickerFor === m.id ? "opacity-100 text-indigo-600" : "text-gray-400 hover:text-indigo-600"}`}
                    title={mine ? "Change your reaction" : "React"}
                  >
                    <SmilePlus size={14} />
                  </button>
                )}
              </div>
              {pickerFor === m.id && (
                <div className="mt-1 flex gap-1 rounded-full border bg-white p-1 shadow-sm">
                  {REACTIONS.map((e) => (
                    <button
                      key={e}
                      onClick={() => { onReact(m.id, e); setPickerFor(null); }}
                      className={`rounded-full px-1.5 py-0.5 text-base transition hover:bg-indigo-50 ${mine?.emoji === e ? "bg-indigo-100" : ""}`}
                    >
                      {e}
                    </button>
                  ))}
                  <button onClick={() => setPickerFor(null)} className="px-1.5 text-xs text-gray-400 hover:text-gray-600">✕</button>
                </div>
              )}
            </div>
          );
        })}
        {typingLabel && (
          <div className="flex items-start" aria-live="polite">
            <div className="rounded-2xl rounded-bl-none border bg-white px-3 py-2 shadow-sm">
              <span className="flex items-center gap-1">
                {[0, 150, 300].map((delay) => (
                  <span key={delay} className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400" style={{ animationDelay: `${delay}ms` }} />
                ))}
              </span>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Blocked / error notice takes the place of the composer. */}
      {notice ? (
        <div className="border-t bg-amber-50 px-3 py-2 text-xs text-amber-800 flex items-center justify-between gap-2">
          <span>{notice}</span>
          {blocked && onUnblock && (
            <button onClick={onUnblock} className="shrink-0 rounded-full border border-amber-300 px-2.5 py-1 font-semibold text-amber-900 transition hover:bg-amber-100">
              Unblock
            </button>
          )}
        </div>
      ) : children}
    </div>
  );
}
