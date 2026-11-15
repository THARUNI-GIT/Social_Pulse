import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useToast } from "../context/ToastContext";
import { searchUsers } from "../services/usersService";
import { listTrendingHashtags, searchPosts } from "../services/postsService";
import { toUiPost, isVideoUrl } from "../adapters/postAdapter";
import { Avatar, ListSkeleton, Page } from "../components/ui";

/** People + post search. Both hit the backend (case-insensitive substring, visibility-scoped). */
export default function Search() {
  const [q, setQ] = useState("");
  const [tab, setTab] = useState("people");
  const [people, setPeople] = useState(null);
  const [posts, setPosts] = useState(null);
  const [loading, setLoading] = useState(false);
  const [trending, setTrending] = useState([]);
  const toast = useToast();
  const nav = useNavigate();

  // Discovery row: most used hashtags, shown only while the box is empty.
  useEffect(() => {
    listTrendingHashtags(10).then((r) => setTrending(r?.items ?? [])).catch(() => setTrending([]));
  }, []);

  useEffect(() => {
    const term = q.trim();
    if (!term || term.startsWith("#")) { setPeople(null); setPosts(null); return; }
    let alive = true;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        if (tab === "people") { const r = await searchUsers(term); if (alive) setPeople(r.items); }
        else { const r = await searchPosts(term); if (alive) setPosts(r.items.map(toUiPost)); }
      } catch (e) { if (alive) toast(e.message); }
      finally { if (alive) setLoading(false); }
    }, 300); // debounce
    return () => { alive = false; clearTimeout(t); };
  }, [q, tab]);

  const term = q.trim();
  const empty = tab === "people" ? people?.length === 0 : posts?.length === 0;

  return (
    <Page>
      <input
        autoFocus
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && term.startsWith("#") && nav(`/explore/${term.slice(1)}`)}
        placeholder="Search people and posts, or #hashtag + Enter"
        className="w-full rounded-xl border px-3 py-3 text-base"
      />
      {!term && trending.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Trending</p>
          <div className="flex flex-wrap gap-2">
            {trending.map((t) => (
              <Link
                key={t.tag}
                to={`/explore/${encodeURIComponent(t.tag)}`}
                className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-600 transition hover:bg-indigo-100"
              >
                #{t.tag}
                <span className="ml-1 text-[10px] text-indigo-400">{t.usageCount}</span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {!term.startsWith("#") && (
        <div className="flex gap-2">
          {["people", "posts"].map((t) => (
            <button key={t} onClick={() => setTab(t)} className={`flex-1 rounded-xl py-2 text-sm capitalize ${tab === t ? "bg-indigo-600 text-white" : "border bg-white"}`}>{t}</button>
          ))}
        </div>
      )}

      {term.startsWith("#") && <p className="text-sm text-gray-500">Press Enter to open the #{term.slice(1)} hashtag feed.</p>}
      {loading && <ListSkeleton />}
      {!loading && empty && <p className="text-sm text-gray-400">No {tab} found for “{term}”.</p>}

      {!loading && tab === "people" && people?.map((u) => (
        <Link key={u.id} to={`/profile/${u.id}`} className="flex items-center gap-3">
          <Avatar user={u} />
          <div><p className="text-sm font-semibold">{u.displayName}{u.verified && " ✔"}</p><p className="text-xs text-gray-500">@{u.handle}</p></div>
        </Link>
      ))}

      {!loading && tab === "posts" && posts?.map((p) => {
        const media = p.mediaUrls?.[0] ?? p.mediaUrl;
        return (
          <Link key={p.id} to={`/post/${p.id}`} className="flex items-center gap-3 rounded-xl border bg-white p-2 transition hover:border-indigo-200">
            {media ? (isVideoUrl(media)
              ? <video src={media} muted className="h-12 w-12 rounded-lg object-cover" />
              : <img src={media} alt="" className="h-12 w-12 rounded-lg object-cover" />)
              : <span className="grid h-12 w-12 place-items-center rounded-lg bg-indigo-50 text-[10px] text-gray-500">text</span>}
            <div className="min-w-0 flex-1">
              <p className="text-sm truncate">{p.caption || "(no caption)"}</p>
              <p className="text-xs text-gray-500">@{p.author?.handle || p.author?.username} · {p.likes ?? 0} likes</p>
            </div>
          </Link>
        );
      })}
    </Page>
  );
}
