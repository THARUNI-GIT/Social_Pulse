import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import AppLayout from "../layouts/AppLayout";
import PostCard from "../components/PostCard";
import { deletePost, getPost } from "../services/postsService";
import { toUiPost } from "../adapters/postAdapter";
import { Page } from "../components/ui";

/** Single post view. Removed or invisible posts land here and are reported gracefully, not as a crash. */
export default function PostPage() {
  const { id } = useParams();
  const [post, setPost] = useState(null);
  const [state, setState] = useState("loading"); // loading | ready | missing
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    setState("loading"); setPost(null); setError("");
    getPost(id)
      .then((p) => { if (alive) { setPost(toUiPost(p)); setState("ready"); } })
      .catch(() => { if (alive) setState("missing"); });
    return () => { alive = false; };
  }, [id]);

  /**
   * PostCard reports `(id, patch)`. This used to take a single object, so a like/comment update
   * spread a string into the post and the page never reflected the change.
   */
  const onUpdate = (postId, patch) => {
    setPost((prev) => (prev && prev.id === postId ? { ...prev, ...patch } : prev));
    setError("");
  };

  const handleDelete = async () => {
    setError("");
    try {
      await deletePost(id);
      setState("missing");
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <AppLayout>
      {state === "loading" && <Page><p className="text-sm text-gray-400">Loading post…</p></Page>}
      {state === "missing" && (
        <Page>
          <h1 className="text-lg font-bold">This post isn't available</h1>
          <p className="text-sm text-gray-500">It may have been removed, or you don't have permission to see it.</p>
          <Link to="/" className="text-sm font-medium text-indigo-600 hover:text-indigo-500">Back to the feed</Link>
        </Page>
      )}
      {state === "ready" && post && (
        <div className="max-w-xl mx-auto space-y-4 pb-24">
          <PostCard
            key={post.id}
            post={post}
            onChange={onUpdate}
            onDelete={handleDelete}
            // Reporting hides the post for this user server-side, so this page can no longer show it.
            onHidden={() => { window.location.href = "/"; }}
          />
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
      )}
    </AppLayout>
  );
}
