import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useToast } from "../context/ToastContext";
import { followers as listFollowers, following as listFollowing, getUser } from "../services/usersService";
import { Avatar, ListSkeleton, Page } from "../components/ui";

/** /profile/:id/followers and /profile/:id/following - the real list behind the profile counters. */
export default function FollowList({ mode = "followers" }) {
  const { id } = useParams();
  const toast = useToast();
  const [owner, setOwner] = useState(null);
  const [items, setItems] = useState(null);
  const [cursor, setCursor] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => { getUser(id).then(setOwner).catch(() => {}); }, [id]);

  const load = async (c) => {
    setLoading(true);
    try {
      const r = await (mode === "followers" ? listFollowers : listFollowing)(id, c);
      setItems((p) => (c ? [...(p || []), ...r.items] : r.items));
      setCursor(r.nextCursor);
    } catch (e) { toast(e.message); setItems([]); } finally { setLoading(false); }
  };
  useEffect(() => { setItems(null); setCursor(null); load(); }, [id, mode]);

  const heading = mode === "followers" ? "Followers" : "Following";
  return (
    <Page>
      <div className="flex items-center gap-2">
        <h1 className="text-lg font-bold">{heading}</h1>
        {owner && <Link to={`/profile/${id}`} className="text-sm text-gray-500 hover:text-indigo-600">@{owner.handle}</Link>}
      </div>
      {!items ? <ListSkeleton /> : items.length ? (
        <>
          {items.map((u) => (
            <Link key={u.id} to={`/profile/${u.id}`} className="flex items-center gap-3 rounded-xl px-1 py-1.5 transition hover:bg-indigo-50/60">
              <Avatar user={u} />
              <div className="min-w-0">
                <p className="text-sm font-semibold truncate">{u.displayName || u.handle}{u.verified && " ✔"}</p>
                <p className="text-xs text-gray-500">@{u.handle}</p>
              </div>
            </Link>
          ))}
          {cursor && <button onClick={() => load(cursor)} disabled={loading} className="w-full rounded-xl border bg-white py-2 text-sm">{loading ? "Loading…" : "Load more"}</button>}
        </>
      ) : <p className="text-sm text-gray-400">No {heading.toLowerCase()} yet.</p>}
    </Page>
  );
}
