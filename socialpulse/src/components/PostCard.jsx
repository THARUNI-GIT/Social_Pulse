import { useState } from "react";
import { Link } from "react-router-dom";
import { Bookmark, Flag, Heart, MessageCircle, MoreHorizontal, Pencil, Share2, Trash2 } from "lucide-react";
import { addComment, deleteComment, deletePost, listComments, toggleBookmark, toggleLike, reportPost, updatePost } from "../services/postsService";
import { follow } from "../services/usersService";
import { useAuth } from "../context/AuthContext";
import { isVideoUrl } from "../adapters/postAdapter";
import { useToast } from "../context/ToastContext";
import { SmartImage } from "./ui";
import ShareSheet from "./chat/ShareSheet";

const initialsOf = (name) => (name || "?").trim().slice(0, 2).toUpperCase();
const timeAgo = (d) => {
  const s = Math.max(0, Math.floor((Date.now() - new Date(d).getTime()) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
};

/** Violation types offered when reporting. Keys match content-service REASONS (validated server-side). */
const REPORT_REASONS = [
  ["spam", "Spam"], ["harassment", "Harassment or bullying"], ["hate", "Hate speech"],
  ["violence", "Violence or threats"], ["nudity", "Nudity"], ["misinformation", "Misinformation"], ["other", "Something else"],
];

/** Media block: images render inline (with a fallback tile if the object is gone), videos with controls. */
function Media({ url }) {
  if (!url) return null;
  if (isVideoUrl(url)) {
    return <video src={url} controls preload="metadata" className="w-full max-h-96 bg-black object-contain" />;
  }
  return <SmartImage src={url} className="h-64 w-full" imgClassName="w-full max-h-96 object-cover bg-gray-100" />;
}

/**
 * One post, used by the feed, a profile grid and the single-post page. Owns its own comment
 * draft/refresh so submitting a comment always re-reads the server's list (persistence, not
 * optimistic-only), and reports changes upward so the surrounding list stays in sync.
 */
export default function PostCard({ post, onChange, onDelete, onHidden, compact = false }) {
  const { user: me } = useAuth();
  const toast = useToast();
  const [p, setP] = useState(post);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [comments, setComments] = useState(null);
  const [error, setError] = useState("");
  const [bookmarked, setBookmarked] = useState(!!post.isBookmarked);
  const [shares, setShares] = useState(p.sharesCount ?? 0);
  const [sharing, setSharing] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  // Owner-only controls. The menu is purely a convenience: the server rejects any edit/delete
  // from a non-author regardless of what the UI shows.
  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editDraft, setEditDraft] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const isOwner = !!me?.id && (p.author?.isSelf || p.author?.id === me.id);

  const patch = (v) => { setP((x) => ({ ...x, ...v })); onChange?.(post.id, v); };
  const author = p.author || {};
  const media = p.mediaUrls?.[0] ?? p.mediaUrl ?? null;

  const like = async () => {
    const was = p.isLiked;
    patch({ isLiked: !was, likes: (p.likes ?? 0) + (was ? -1 : 1) });
    try { const r = await toggleLike(p.id, was); patch({ isLiked: r.isLiked, likes: r.likes }); }
    catch { patch({ isLiked: was, likes: p.likes }); setError("Couldn't update like"); }
  };

  const refreshComments = async () => {
    try { const r = await listComments(p.id); setComments(r.items); return r.items; }
    catch { return null; }
  };

  const comment = async () => {
    const text = draft.trim(); if (!text) return;
    setBusy(true); setError("");
    try {
      await addComment(p.id, text);
      setDraft("");
      const items = await refreshComments();
      // Count comes from the server counter, not from the (paginated) list we just loaded.
      if (items) patch({ comments: items, commentsCount: Math.max((p.commentsCount ?? 0) + 1, items.length) });
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  const removeComment = async (c) => {
    if (!window.confirm("Delete this comment?")) return;
    setError("");
    try {
      await deleteComment(p.id, c.id);
      const items = await refreshComments();
      if (items) patch({ comments: items, commentsCount: Math.max(items.length, (p.commentsCount ?? 1) - 1) });
    } catch (e) { setError(e.message); }
  };

  const bookmark = async () => {
    const was = bookmarked; setBookmarked(!was);
    try { await toggleBookmark(p.id, was); } catch { setBookmarked(was); setError("Couldn't update bookmark"); }
  };

  const toggleFollow = async () => {
    const was = !!author.isFollowing;
    patch({ author: { ...author, isFollowing: !was } });
    try { await follow(author.id, !was); }
    catch (e) { patch({ author: { ...author, isFollowing: was } }); setError(e.message); }
  };

  /** Share opens the in-app sheet: pick chats or people to send the post to. */
  const share = () => setShareOpen(true);

  // ----- reporting: the violation type is chosen from buttons, never typed -----
  const [reportOpen, setReportOpen] = useState(false);
  const [reportReason, setReportReason] = useState("spam");
  const [reporting, setReporting] = useState(false);
  const [reported, setReported] = useState(false);

  const report = async (reason) => {
    setReportReason(reason);
    setReporting(true); setError("");
    try {
      await reportPost(p.id, reason, `Reported as ${reason}`);
      setReported(true); setReportOpen(false);
      // The report hides this post for this user server-side, so drop the card right away instead
      // of leaving something on screen that will be gone after the next refresh.
      onHidden?.(p.id);
      toast("Post hidden. Thanks for reporting", "info");
    } catch (e) { setError(e.message); }
    finally { setReporting(false); }
  };

  // ----- owner: edit caption -----
  const startEdit = () => { setEditDraft(p.caption ?? ""); setError(""); setMenuOpen(false); setEditing(true); };
  const cancelEdit = () => { setEditing(false); setEditDraft(""); };
  const saveEdit = async () => {
    const caption = editDraft.trim();
    // Captions are required by the API (1..2200 chars); block an empty save rather than sending it.
    if (!caption) { setError("A caption can't be empty."); return; }
    if (caption === p.caption) { setEditing(false); return; }
    setSavingEdit(true); setError("");
    try {
      const updated = await updatePost(p.id, { caption });
      // Re-read from the server so tags/counts match what was actually persisted.
      const merged = updated ? { ...p, ...updated } : { ...p, caption };
      setP(merged);
      onChange?.(p.id, merged);
      setEditing(false); setEditDraft("");
    } catch (e) { setError(e.message); }
    finally { setSavingEdit(false); }
  };

  // ----- owner: delete -----
  const remove = async () => {
    if (!window.confirm("Delete this post? This can't be undone.")) return;
    setDeleting(true); setError("");
    try {
      await deletePost(p.id);
      // Only remove the row once the server confirms, so a failed delete never loses the post.
      onDelete?.(p.id);
    } catch (e) { setError(e.message); setDeleting(false); }
  };

  const shown = comments ?? p.comments ?? [];
  // `comments` is a page of at most 50, so the stored counter is the source of truth.
  const total = p.commentsCount ?? comments?.length ?? shown.length;

  return (
    <article className="card card-hover overflow-hidden">
      <header className="flex items-center gap-3 p-4">
        <Link to={`/profile/${author.id}`} className="shrink-0">
          {author.avatarUrl ? (
            <img src={author.avatarUrl} alt="" className="h-10 w-10 rounded-full object-cover" />
          ) : (
            <span className="grid h-10 w-10 place-items-center rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 text-sm font-semibold text-white">
              {initialsOf(author.displayName || author.username || author.handle)}
            </span>
          )}
        </Link>
        <div className="flex-1 min-w-0">
          <Link to={`/profile/${author.id}`} className="block text-sm font-semibold truncate hover:text-indigo-600">
            {author.displayName || author.username || "User"}{author.verified && " ✔"}
          </Link>
          <p className="text-xs text-gray-500">@{author.handle || author.username} · {timeAgo(p.createdAt)}</p>
        </div>
        {!author.isSelf && author.id !== me?.id && (
          <button
            onClick={toggleFollow}
            className={`rounded-full px-3 py-1 text-xs font-semibold transition ${author.isFollowing ? "border border-gray-300 text-gray-700" : "bg-indigo-600 text-white hover:bg-indigo-500"}`}
          >
            {author.isFollowing ? "Following" : "Follow"}
          </button>
        )}
        {isOwner && (
          <div className="relative">
            <button onClick={() => setMenuOpen((v) => !v)} className="icon-btn" title="Post options" aria-haspopup="menu" aria-expanded={menuOpen}>
              <MoreHorizontal size={16} />
            </button>
            {menuOpen && (
              <div className="absolute right-0 z-20 mt-1 w-36 overflow-hidden rounded-xl border border-gray-200 bg-white py-1 shadow-lg">
                <button
                  onClick={startEdit}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-gray-700 transition hover:bg-indigo-50"
                >
                  <Pencil size={13} /> Edit caption
                </button>
                <button
                  onClick={remove}
                  disabled={deleting}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-red-600 transition hover:bg-red-50 disabled:opacity-50"
                >
                  <Trash2 size={13} /> {deleting ? "Deleting…" : "Delete"}
                </button>
              </div>
            )}
          </div>
        )}
        <div className="relative">
          <button
            onClick={() => setReportOpen((v) => !v)}
            className={`icon-btn ${reported ? "text-amber-600" : ""}`}
            title={reported ? "Reported — an admin will review it" : "Report post"}
            aria-haspopup="menu"
            aria-expanded={reportOpen}
          >
            <Flag size={16} />
          </button>
          {reportOpen && (
            <div role="menu" aria-label="Report reason" className="absolute right-0 z-20 mt-1 w-56 rounded-xl border border-gray-200 bg-white p-1 shadow-lg">
              <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">Why are you reporting this?</p>
              {REPORT_REASONS.map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => report(key)}
                  disabled={reporting}
                  className={`flex w-full items-center rounded-lg px-2 py-1.5 text-left text-xs font-medium transition disabled:opacity-50 ${reportReason === key ? "bg-indigo-50 text-indigo-700" : "text-gray-700 hover:bg-gray-50"}`}
                >
                  {reporting && reportReason === key ? "Reporting…" : label}
                </button>
              ))}
            </div>
          )}
        </div>
      </header>

      {media ? <Media url={media} /> : null}

      <div className="p-4 space-y-2">
        <div className="flex items-center gap-4">
          <button onClick={like} className={`flex items-center gap-1.5 text-sm transition ${p.isLiked ? "text-rose-500" : "text-gray-600 hover:text-rose-500"}`}>
            <Heart key={String(p.isLiked)} size={20} className={p.isLiked ? "fill-rose-500 text-rose-500 animate-pop" : ""} />{p.likes ?? 0}
          </button>
          <Link to={`/post/${p.id}`} className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-indigo-600"><MessageCircle size={20} />{total}</Link>
          <button onClick={share} className="flex items-center gap-1.5 text-sm text-gray-600 transition hover:text-indigo-600" title="Share this post"><Share2 size={20} />{shares}</button>
          <button onClick={bookmark} className="ml-auto icon-btn" title="Bookmark"><Bookmark size={20} className={bookmarked ? "fill-indigo-600 text-indigo-600" : ""} /></button>
        </div>

        {editing ? (
          <div className="space-y-2">
            <textarea
              value={editDraft}
              onChange={(e) => setEditDraft(e.target.value)}
              maxLength={2200}
              rows={3}
              autoFocus
              placeholder="Write a caption…"
              className="w-full rounded-xl border border-gray-200 bg-gray-50 p-3 text-sm transition focus:border-indigo-300 focus:bg-white focus:outline-none focus:ring-4 focus:ring-indigo-100"
            />
            <div className="flex items-center gap-2">
              <button
                onClick={saveEdit}
                disabled={savingEdit || !editDraft.trim()}
                className="rounded-full bg-indigo-600 px-4 py-1.5 text-xs font-semibold text-white transition hover:bg-indigo-500 disabled:opacity-40"
              >
                {savingEdit ? "Saving…" : "Save"}
              </button>
              <button onClick={cancelEdit} disabled={savingEdit} className="rounded-full border border-gray-200 px-4 py-1.5 text-xs font-medium text-gray-600 transition hover:bg-gray-50 disabled:opacity-40">
                Cancel
              </button>
              <span className="ml-auto text-[10px] text-gray-400">{editDraft.length}/2200</span>
            </div>
          </div>
        ) : (
          p.caption && <p className="text-sm leading-relaxed">{p.caption}</p>
        )}
        {!!p.tags?.length && (
          <p className="flex flex-wrap gap-1.5">
            {p.tags.map((t) => (
              <Link key={t} to={`/explore/${t.replace(/^#/, "")}`} className="rounded-full bg-indigo-50 px-2.5 py-0.5 text-xs font-medium text-indigo-600 transition hover:bg-indigo-100">{t}</Link>
            ))}
          </p>
        )}

        {shown.map((c) => {
          // The server allows the comment author and the post owner to delete; mirror that here.
          const mine = (c.authorId || c.author?.id) === me?.id;
          const removable = mine || isOwner;
          return (
            <div key={c.id} className="flex items-start gap-2 text-sm">
              <p className="min-w-0 flex-1">
                <b>{c.author?.displayName || c.author?.username || c.user}</b> {c.content ?? c.text}
              </p>
              {removable && (
                <button
                  onClick={() => removeComment(c)}
                  className="shrink-0 text-[11px] text-gray-400 transition hover:text-red-600"
                  title="Delete comment"
                >
                  Delete
                </button>
              )}
            </div>
          );
        })}
        {!compact && total > shown.length && (
          <Link to={`/post/${p.id}`} className="text-xs font-medium text-gray-500 hover:text-indigo-600">View all {total} comments</Link>
        )}

        <div className="flex gap-2 pt-1">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !busy && comment()}
            placeholder="Add a comment…"
            className="flex-1 rounded-full border border-gray-200 bg-gray-50 px-3.5 py-2 text-sm transition focus:border-indigo-300 focus:bg-white focus:outline-none focus:ring-4 focus:ring-indigo-100"
          />
          <button onClick={comment} disabled={busy || !draft.trim()} className="rounded-full px-3 text-sm font-semibold text-indigo-600 transition hover:bg-indigo-50 disabled:opacity-40">Post</button>
        </div>
        {reported && <p className="text-xs text-emerald-600">Post hidden. Thanks for reporting.</p>}
        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>
      <ShareSheet open={shareOpen} post={p} onClose={() => setShareOpen(false)} />
    </article>
  );
}
