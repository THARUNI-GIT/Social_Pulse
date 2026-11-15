import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useToast } from "../context/ToastContext";
import { adminOverview, adminReports, adminResolve, adminSuspend, adminUsers } from "../services/usersService";
import { adminComment, adminPost, adminRestoreComment, adminRestorePost } from "../services/postsService";
import { isVideoUrl } from "../adapters/postAdapter";
import { ListSkeleton } from "../components/ui";

const shortId = (id) => (id ? `${id.slice(0, 8)}…` : "—");

/** Media thumbnail for the moderated post (first attachment only keeps the queue compact). */
function Thumb({ url }) {
  if (!url) return null;
  if (isVideoUrl(url)) {
    return <video src={url} muted playsInline preload="metadata" className="h-20 w-20 shrink-0 rounded-lg bg-black object-cover" />;
  }
  return <img src={url} alt="" className="h-20 w-20 shrink-0 rounded-lg bg-gray-100 object-cover" />;
}

function ReportCard({ r, pending, onResolve, onRestore }) {
  const [target, setTarget] = useState(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let alive = true;
    // Admin endpoints: removed (soft-deleted) content stays readable here, unlike the public routes.
    const load = r.targetType === "post" ? adminPost : adminComment;
    load(r.targetId)
      .then((t) => { if (alive) setTarget(t); })
      .catch(() => { if (alive) setTarget(null); })
      .finally(() => { if (alive) setLoaded(true); });
    return () => { alive = false; };
  }, [r.targetId, r.targetType]);

  const btn = "flex-1 rounded-xl py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-60";
  const removed = !!target?.removed;
  return (
    <div className="rounded-2xl border border-gray-200/70 bg-white p-4 shadow-card space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-amber-600">{r.targetType}</span>
        <span className="text-sm text-gray-600">reported for <b className="text-gray-900">{r.reason}</b></span>
        <span className="ml-auto text-[11px] text-gray-400">{new Date(r.createdAt).toLocaleString()}</span>
      </div>

      {r.targetType === "post" && (
        loaded && target ? (
          <div className="flex gap-3 rounded-lg bg-gray-50 p-2">
            <Thumb url={target.mediaUrls?.[0]} />
            <div className="min-w-0 flex-1">
              <p className="line-clamp-3 text-sm text-gray-700">{target.caption || "No caption"}</p>
              <p className="mt-1 text-[11px] text-gray-500">
                by <span className="font-mono">{shortId(target.authorId)}</span>
                {target.removed
                  ? <span className="ml-2 rounded-full bg-red-50 px-2 py-0.5 font-semibold text-red-500">removed</span>
                  : <Link to={`/post/${target.id}`} className="ml-2 font-medium text-indigo-600 hover:underline">open post</Link>}
              </p>
            </div>
          </div>
        ) : (
          <p className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-500">
            Post <span className="font-mono">{shortId(r.targetId)}</span> is no longer available.
          </p>
        )
      )}
      {r.targetType === "comment" && (
        loaded && target ? (
          <div className="rounded-lg bg-gray-50 p-2">
            <p className="line-clamp-3 text-sm text-gray-700">"{target.content || "No text"}"</p>
            <p className="mt-1 text-[11px] text-gray-500">
              by <span className="font-mono">{shortId(target.authorId)}</span>
              {target.removed
                ? <span className="ml-2 rounded-full bg-red-50 px-2 py-0.5 font-semibold text-red-500">removed</span>
                : <Link to={`/post/${target.postId}`} className="ml-2 font-medium text-indigo-600 hover:underline">open post</Link>}
            </p>
          </div>
        ) : (
          <p className="text-xs text-gray-500">Comment <span className="font-mono">{shortId(r.targetId)}</span> is no longer available.</p>
        )
      )}
      {r.details && <p className="text-xs text-gray-500">{r.details}</p>}

      <div className="flex gap-2 pt-1">
        {r.status === "open" ? (
          <>
            <button onClick={() => onResolve(r, "remove")} disabled={pending} aria-busy={pending} className={`${btn} bg-red-600 text-white hover:bg-red-500`}>
              {pending ? "Working…" : r.targetType === "comment" ? "Remove comment" : "Remove post"}
            </button>
            <button onClick={() => onResolve(r, "dismiss")} disabled={pending} className={`${btn} border border-gray-200 text-gray-700 hover:border-gray-300 hover:bg-gray-50`}>
              Keep it (no problem)
            </button>
          </>
        ) : r.status === "resolved" ? (
          <button
            onClick={() => onRestore(r)}
            disabled={pending || !removed}
            className={`${btn} border border-indigo-200 text-indigo-700 hover:bg-indigo-50`}
            title={removed ? "Make this content visible again" : "This content is already visible"}
          >
            {pending ? "Restoring…" : !removed ? "Already restored" : r.targetType === "comment" ? "Restore comment" : "Restore post"}
          </button>
        ) : (
          <p className="flex-1 rounded-xl bg-gray-50 py-2 text-center text-xs text-gray-500">
            {r.status === "resolved" ? "Removed" : "Kept — no action needed"}
          </p>
        )}
      </div>
    </div>
  );
}

export default function Admin() {
  const toast = useToast();
  const [tab, setTab] = useState("reports");
  const [status, setStatus] = useState("open");
  const [stats, setStats] = useState(null);
  const [reports, setReports] = useState(null);
  const [users, setUsers] = useState(null);
  const [q, setQ] = useState("");
  const [pending, setPending] = useState(() => new Set());
  const busyRef = useRef(new Set());

  const loadStats = useCallback(() => adminOverview().then(setStats).catch(() => {}), []);
  const loadReports = useCallback(
    (s = status) => adminReports(s).then((r) => setReports(r.items)).catch((e) => toast(e.message)),
    [status, toast]
  );

  useEffect(() => { setReports(null); loadReports(); }, [status, loadReports]);
  useEffect(() => {
    loadStats();
    if (tab !== "reports") return;
    const t = setInterval(() => { loadStats(); loadReports(); }, 20_000);
    return () => clearInterval(t);
  }, [tab, loadStats, loadReports]);
  useEffect(() => {
    if (tab !== "users") return;
    const t = setTimeout(() => adminUsers(q).then((r) => setUsers(r.items)).catch((e) => toast(e.message)), 250);
    return () => clearTimeout(t);
  }, [tab, q, toast]);

  const withBusy = async (key, fn) => {
    if (busyRef.current.has(key)) return;
    busyRef.current.add(key);
    setPending(new Set(busyRef.current));
    try { await fn(); }
    finally {
      busyRef.current.delete(key);
      setPending(new Set(busyRef.current));
    }
  };

  const resolve = (r, action) => withBusy(r.id, async () => {
    try {
      await adminResolve(r.id, action);
      toast(action === "remove" ? "Content removed — the reporter and author were notified" : "Content kept — the reporter was notified", "info");
      setReports((p) => (Array.isArray(p) ? p.filter((x) => x.id !== r.id) : p));
      await Promise.all([loadStats(), loadReports()]);
    } catch (e) {
      toast(e.message);
      await loadReports();
    }
  });

  const restore = (r) => withBusy(`restore:${r.id}`, async () => {
    try {
      const restoreOne = r.targetType === "comment" ? adminRestoreComment : adminRestorePost;
      await restoreOne(r.targetId);
      toast(`${r.targetType === "comment" ? "Comment" : "Post"} restored — it is visible again and the author was notified`, "info");
      await loadReports();
    } catch (e) { toast(e.message); }
  });

  const suspend = async (u) => {
    const on = !u.suspended;
    setUsers((p) => p.map((x) => ({ ...x, suspended: on })));
    try {
      await adminSuspend(u.id, on);
      loadStats();
    } catch (e) {
      toast(e.message);
      setUsers((p) => p.map((x) => ({ ...x, suspended: !on })));
    }
  };

  const tiles = [["Users", stats?.users?.users], ["Suspended", stats?.users?.suspended], ["Open reports", stats?.content?.openReports]];
  const tabs = [["reports", "Reports"], ["users", "Users"]];
  const statuses = [["open", "Open"], ["resolved", "Removed"], ["dismissed", "Kept"]];
  return (
    <div className="max-w-xl mx-auto space-y-4 pb-24">
      <h1 className="text-lg font-bold tracking-tight">Admin</h1>
      <div className="grid grid-cols-3 gap-2 text-center">
        {tiles.map(([l, v], i) => (
          <div key={l} className="rounded-2xl border border-gray-200/70 bg-white p-3 shadow-card">
            <p className={`text-xl font-bold ${i === 2 && (v ?? 0) > 0 ? "text-amber-500" : "text-gray-900"}`}>{v ?? "–"}</p>
            <p className="text-xs text-gray-500">{l}</p>
          </div>
        ))}
      </div>
      <div className="flex gap-1 rounded-xl border border-gray-200/70 bg-white p-1 shadow-sm">
        {tabs.map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)} className={`flex-1 rounded-lg py-1.5 text-sm font-medium transition ${tab === key ? "bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-sm" : "text-gray-600 hover:bg-gray-50"}`}>{label}</button>
        ))}
      </div>

      {tab === "reports" && (
        <>
          <div className="flex gap-1 rounded-xl border border-gray-200/70 bg-white p-1 shadow-sm">
            {statuses.map(([key, label]) => (
              <button
                key={key}
                onClick={() => setStatus(key)}
                className={`flex-1 rounded-lg py-1.5 text-xs font-medium transition ${status === key ? "bg-gray-900 text-white" : "text-gray-600 hover:bg-gray-50"}`}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-gray-500">
            {status === "open" ? "Reports waiting for a decision." : "Action history — the decision taken on each report."}
          </p>
          {reports
            ? (reports.length
              ? <div className="space-y-3">{reports.map((r) => <ReportCard key={r.id} r={r} pending={pending.has(r.id) || pending.has(`restore:${r.id}`)} onResolve={resolve} onRestore={restore} />)}</div>
              : <p className="text-sm text-gray-400">
                  {status === "open" ? "No open reports." : status === "resolved" ? "Nothing has been removed yet." : "No reports have been dismissed."}
                </p>)
            : <ListSkeleton />}
        </>
      )}

      {tab === "users" && (
        <>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search handle, name, email" className="w-full rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm transition focus:border-indigo-300 focus:outline-none focus:ring-4 focus:ring-indigo-100" />
          {!users ? (
            <ListSkeleton />
          ) : users.length ? (
            <div className="space-y-2">
              {users.map((u) => (
                <div key={u.id} className="flex items-center justify-between gap-3 rounded-2xl border border-gray-200/70 bg-white px-4 py-3 shadow-card">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">
                      @{u.handle}{' '}
                      {u.suspended && <span className="ml-1 rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-semibold uppercase text-red-500">suspended</span>}
                    </p>
                    <p className="truncate text-xs text-gray-500">{u.displayName || "—"} · {u.email}</p>
                  </div>
                  <button onClick={() => suspend(u)} className={`shrink-0 rounded-xl border px-3 py-1.5 text-xs font-semibold transition ${u.suspended ? "border-indigo-200 text-indigo-600 hover:bg-indigo-50" : "border-red-200 text-red-600 hover:bg-red-50"}`}>
                    {u.suspended ? "Unsuspend" : "Suspend"}
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-400">No users match.</p>
          )}
        </>
      )}
    </div>
  );
}
