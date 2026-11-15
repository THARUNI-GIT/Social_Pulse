import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import { ImageOff } from "lucide-react";
import { isVideoUrl } from "../adapters/postAdapter";

export const Skeleton = ({ className = "h-4 w-full" }) => <div className={`skeleton rounded-lg bg-gray-200 ${className}`} />;
export const ListSkeleton = ({ rows = 4 }) => <div className="space-y-3">{Array.from({ length: rows }, (_, i) => <div key={i} className="flex items-center gap-3"><Skeleton className="h-10 w-10 rounded-full" /><div className="flex-1 space-y-2"><Skeleton className="h-3 w-1/2" /><Skeleton className="h-3 w-3/4" /></div></div>)}</div>;
export const GridSkeleton = () => <div className="grid grid-cols-3 gap-1">{Array.from({ length: 9 }, (_, i) => <Skeleton key={i} className="aspect-square rounded-none" />)}</div>;
export const PostSkeleton = () => (
  <div className="card space-y-3 p-4">
    <div className="flex items-center gap-3"><Skeleton className="h-10 w-10 rounded-full" /><div className="flex-1 space-y-2"><Skeleton className="h-3 w-32" /><Skeleton className="h-2.5 w-20" /></div></div>
    <Skeleton className="h-40 w-full rounded-xl" />
    <Skeleton className="h-3 w-4/5" /><Skeleton className="h-3 w-2/5" />
  </div>
);
export const Page = ({ children }) => <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }} className="max-w-xl mx-auto p-4 pb-24 space-y-4">{children}</motion.div>;

/**
 * Every image goes through here: a source that 404s (expired object, wrong host) is replaced by a
 * branded tile instead of the browser's broken-image glyph. Videos keep their own fallback text.
 */
export function SmartImage({ src, alt = "", className = "", imgClassName = "", rounded = "", children }) {
  const [failed, setFailed] = useState(!src);
  useEffect(() => { setFailed(!src); }, [src]);
  if (!src || failed) {
    return (
      <div role="img" aria-label={alt || "Image unavailable"} className={`img-fallback grid place-items-center bg-gray-100 text-gray-400 ${rounded} ${className}`}>
        <span className="flex flex-col items-center gap-1 text-[11px]"><ImageOff size={20} /> Image unavailable</span>
      </div>
    );
  }
  return <img src={src} alt={alt} loading="lazy" className={`${rounded} ${imgClassName || className}`} onError={() => setFailed(true)} />;
}

const PALETTE = ["from-indigo-500 to-violet-600", "from-sky-500 to-indigo-600", "from-emerald-500 to-teal-600", "from-amber-500 to-orange-600", "from-rose-500 to-pink-600", "from-fuchsia-500 to-purple-600"];
const hash = (s = "") => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
export const initialsOf = (user) => (user?.displayName || user?.handle || user?.username || "?").trim().slice(0, 2).toUpperCase();

/** Avatar with a deterministic colour per person and an initials fallback if the URL breaks. */
export const Avatar = ({ user, size = 40, className = "" }) => {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [user?.avatarUrl]);
  const gradient = PALETTE[hash(user?.displayName || user?.handle || user?.id) % PALETTE.length];
  if (user?.avatarUrl && !failed) {
    return <img src={user.avatarUrl} alt="" style={{ width: size, height: size }} className={`rounded-full object-cover shrink-0 ${className}`} onError={() => setFailed(true)} />;
  }
  return (
    <span
      style={{ width: size, height: size, fontSize: Math.max(10, size * 0.34) }}
      className={`grid shrink-0 place-items-center rounded-full bg-gradient-to-br ${gradient} font-semibold text-white ${className}`}
      aria-hidden="true"
    >
      {initialsOf(user)}
    </span>
  );
};

/** Empty states carry an icon, a title and one line of guidance — never a bare sentence. */
export function EmptyState({ icon: Icon, emoji, title, hint, action }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-gray-200 px-6 py-10 text-center">
      <span className="grid h-12 w-12 place-items-center rounded-full bg-indigo-50 text-indigo-500">
        {Icon ? <Icon size={22} /> : <span className="text-xl" aria-hidden="true">{emoji || "✦"}</span>}
      </span>
      <p className="text-sm font-semibold text-gray-900">{title}</p>
      {hint && <p className="max-w-xs text-xs text-gray-500">{hint}</p>}
      {action}
    </div>
  );
}

export function PostGrid({ posts }) {
  if (!posts.length) return <EmptyState emoji="🖼️" title="Nothing here yet" hint="Posts you create or save will appear here." />;
  return <div className="grid grid-cols-3 gap-1">{posts.map((p) => {
    const media = p.mediaUrls?.[0] ?? p.mediaUrl;
    return (
      <Link key={p.id} to={`/post/${p.id}`} className="relative block aspect-square overflow-hidden bg-indigo-50 transition hover:opacity-90">
        {media && isVideoUrl(media) ? (
          <><video src={media} muted preload="metadata" className="h-full w-full object-cover" /><span className="absolute bottom-1 right-1 rounded bg-black/60 px-1 text-[10px] text-white">▶</span></>
        ) : media ? (
          <SmartImage src={media} className="h-full w-full" imgClassName="h-full w-full object-cover" />
        ) : (
          <span className="block p-2 text-[11px] leading-snug text-gray-700 line-clamp-4">{p.caption}</span>
        )}
      </Link>
    );
  })}</div>;
}
