import { useCallback, useEffect, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Link } from "react-router-dom";
import { Plus } from "lucide-react";
import AppLayout from "../layouts/AppLayout";
import CreateModal from "../components/create/CreateModal";
import PostCard from "../components/PostCard";
import { listFeed } from "../services/postsService";
import { toUiPost } from "../adapters/postAdapter";
import { EmptyState, PostSkeleton } from "../components/ui";

export default function Home() {
  const [posts, setPosts] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  // "For you" is the global visible feed; "Following" is restricted server-side to accounts you
  // follow (plus yourself), so it is a real timeline and not a client-side filter.
  const [feed, setFeed] = useState("for-you");
  const reduce = useReducedMotion();

  const load = useCallback(async (c) => {
    setLoading(true); setError("");
    try {
      const { items, nextCursor } = await listFeed({ cursor: c, limit: 20, feed: feed === "following" ? "following" : undefined });
      setPosts((p) => (c ? [...p, ...items.map(toUiPost)] : items.map(toUiPost)));
      setCursor(nextCursor);
    } catch (e) { setError(e.message); } finally { setLoading(false); }
  }, [feed]);
  useEffect(() => { setPosts([]); setCursor(null); load(); }, [load]);

  // Keep the list in sync with edits made inside a card (like counts, comments, follow state).
  const onChange = useCallback((id, patch) => setPosts((p) => p.map((x) => (x.id === id ? { ...x, ...patch } : x))), []);
  // A confirmed delete removes the row only after the server accepted it.
  const onDeleted = useCallback((id) => setPosts((p) => p.filter((x) => x.id !== id)), []);

  return (
    <AppLayout>
      <div className="max-w-xl mx-auto space-y-4 pb-24">
        <div className="flex gap-1 rounded-xl border border-gray-200/70 bg-white p-1 shadow-sm">
          {[["for-you", "For you"], ["following", "Following"]].map(([key, label]) => (
            <button
              key={key}
              onClick={() => setFeed(key)}
              className={`flex-1 rounded-lg py-1.5 text-sm font-medium transition ${feed === key ? "bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-sm" : "text-gray-600 hover:bg-gray-50"}`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <button onClick={() => setCreating(true)} className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:from-indigo-500 hover:to-violet-500">
            <Plus size={16} /> New post
          </button>
          <Link to="/bookmarks" className="rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 shadow-sm transition hover:border-indigo-200 hover:text-indigo-600">Bookmarks</Link>
        </div>
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}
        {loading && !posts.length && <><PostSkeleton /><PostSkeleton /></>}
        {!loading && !error && !posts.length && (
          <EmptyState
            emoji={feed === "following" ? "👥" : "✍️"}
            title={feed === "following" ? "Your following feed is quiet" : "No posts yet"}
            hint={feed === "following" ? "Follow a few people and their posts will show up here." : "Share something and it will appear right here."}
            action={feed === "following"
              ? <Link to="/search" className="mt-1 text-xs font-semibold text-indigo-600 hover:underline">Find people to follow</Link>
              : <button onClick={() => setCreating(true)} className="mt-1 text-xs font-semibold text-indigo-600 hover:underline">Create the first post</button>}
          />
        )}
        {posts.map((p, i) => (
          <motion.div
            key={p.id}
            initial={reduce ? false : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, delay: reduce ? 0 : Math.min(i, 6) * 0.035 }}
          >
            <PostCard post={p} onChange={onChange} onDelete={onDeleted} onHidden={onDeleted} />
          </motion.div>
        ))}
        {cursor && <button onClick={() => load(cursor)} disabled={loading} className="w-full rounded-xl border bg-white py-2 text-sm">{loading ? "Loading…" : "Load more"}</button>}
      </div>
      <CreateModal open={creating} onClose={() => setCreating(false)} onCreated={() => load()} />
    </AppLayout>
  );
}
