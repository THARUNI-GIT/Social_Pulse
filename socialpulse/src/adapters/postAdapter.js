/** Video URLs come from the same media bucket; the extension decides how to render them. */
const VIDEO_RE = /\.(mp4|webm|ogv|mov|m4v)(\?|#|$)/i;
export const isVideoUrl = (url) => typeof url === "string" && VIDEO_RE.test(url);

export function toUiPost(p) {
  if (!p) return null;
  const authorName = p.author?.displayName || p.author?.username || p.author?.handle || "User";
  const initials = authorName.slice(0, 2).toUpperCase();
  const colors = ["bg-indigo-500", "bg-purple-500", "bg-rose-500", "bg-amber-500", "bg-emerald-500", "bg-sky-500"];
  const colorIndex = (p.author?.id ? p.author.id.charCodeAt(0) : 0) % colors.length;
  const avatarBg = colors[colorIndex];

  const date = p.createdAt ? new Date(p.createdAt) : new Date();
  const timeAgo = formatTimeAgo(date);

  const gradients = [
    "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
    "linear-gradient(135deg, #ff9a9e 0%, #fecfef 99%, #fecfef 100%)",
    "linear-gradient(135deg, #f6d365 0%, #fda085 100%)",
    "linear-gradient(135deg, #84fab0 0%, #8fd3f4 100%)",
  ];
  const gradientStyle = gradients[p.id ? p.id.charCodeAt(0) % gradients.length : 0];

  return {
    id: p.id,
    author: {
      id: p.author?.id,
      name: authorName,
      // Raw API fields (a bare handle, no "@"): components render the "@" themselves, so
      // pre-prefixing it here produced a doubled "@@handle" on every card.
      displayName: p.author?.displayName || authorName,
      username: p.author?.username || p.author?.handle || null,
      handle: p.author?.handle || p.author?.username || authorName,
      avatarUrl: p.author?.avatarUrl || null,
      isSelf: !!p.author?.isSelf,
      isFollowing: !!p.author?.isFollowing,
      initials,
      avatarBg,
      verified: !!p.author?.verified,
      timeAgo,
    },
    caption: p.caption || "",
    tags: p.tags || [],
    mediaUrls: p.mediaUrls || [],
    mediaUrl: p.mediaUrls?.[0] || null,
    visibility: p.visibility || "public",
    isVideo: isVideoUrl(p.mediaUrls?.[0] ?? p.mediaUrl),
    likes: p.likes ?? 0,
    isLiked: !!p.isLiked,
    // These three were being dropped here, which made the UI lie: comment counts fell back to the
    // two comments embedded in the feed payload, bookmarks looked empty after every reload and the
    // share control had no number to show.
    commentsCount: p.commentsCount ?? (p.comments?.length ?? 0),
    sharesCount: p.sharesCount ?? 0,
    isBookmarked: !!p.isBookmarked,
    comments: p.comments || [],
    gradientStyle,
    createdAt: p.createdAt,
  };
}

function formatTimeAgo(date) {
  const seconds = Math.floor((new Date() - date) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}
