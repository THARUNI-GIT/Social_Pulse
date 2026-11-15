import api, { unwrap, fail } from "./api";

// GET /posts?cursor=&limit=&feed=  -> { items, nextCursor }
// `feed: "following"` restricts the timeline to people you follow (plus your own posts).
export const listFeed = ({ cursor, limit = 20, feed } = {}) =>
  api.get("/posts", { params: { cursor, limit, ...(feed ? { feed } : {}) } }).then(unwrap).catch(fail);

// Swap for: POST|DELETE /posts/:id/reactions  -> { postId, isLiked, likes }
export const toggleLike = (postId, currentlyLiked) =>
  (currentlyLiked
    ? api.delete(`/posts/${postId}/reactions`)
    : api.post(`/posts/${postId}/reactions`, { reactionType: "like" })
  ).then(unwrap).catch(fail);

// Swap for: POST /posts/:id/comments  -> comment { id, user, text, ... }
export const addComment = (postId, text) =>
  api.post(`/posts/${postId}/comments`, { content: text }).then(unwrap).catch(fail);

// Swap for: POST /posts. The server parses #hashtags from the caption, so any
// hashtags not already in the caption are appended to it here.
export const createPost = ({ caption = "", hashtags = [], visibility = "public", mediaUrls } = {}) => {
  const extra = (hashtags || [])
    .map((h) => "#" + String(h).replace(/^#/, ""))
    .filter((h) => !caption.toLowerCase().includes(h.toLowerCase()));
  const full = [caption.trim(), ...extra].filter(Boolean).join(" ");
  return api.post("/posts", { caption: full, visibility, ...(mediaUrls ? { mediaUrls } : {}) }).then(unwrap).catch(fail);
};

// Swap for: POST|DELETE /posts/:id/bookmark  -> { postId, isBookmarked }
export const toggleBookmark = (postId, currentlyBookmarked) =>
  (currentlyBookmarked ? api.delete(`/posts/${postId}/bookmark`) : api.post(`/posts/${postId}/bookmark`))
    .then(unwrap).catch(fail);

// Owner-only caption edit. The server re-derives hashtags from the new caption and enforces
// authorship (403 for anyone else), so hiding the button is a convenience, not the control.
export const updatePost = (postId, { caption, visibility }) =>
  api.patch(`/posts/${postId}`, { ...(caption !== undefined ? { caption } : {}), ...(visibility !== undefined ? { visibility } : {}) })
    .then(unwrap).catch(fail);

// Owner-only soft delete; the row keeps its media references, nothing is orphaned.
export const deletePost = (postId) => api.delete(`/posts/${postId}`).then(unwrap).catch(fail);

// Assumed content-service routes (verify against your controller): GET /posts?authorId=, GET /posts/bookmarks, GET /posts/hashtags/:tag
export const listByAuthor = (authorId, { cursor, limit = 30 } = {}) => api.get("/posts", { params: { authorId, cursor, limit } }).then(unwrap).catch(fail);
export const listBookmarks = ({ cursor, limit = 30 } = {}) => api.get("/posts/bookmarks", { params: { cursor, limit } }).then(unwrap).catch(fail);
export const listByHashtag = (tag, { cursor, limit = 30 } = {}) => api.get(`/posts/hashtags/${encodeURIComponent(tag.replace(/^#/, ""))}`, { params: { cursor, limit } }).then(unwrap).catch(fail);
export const getPost = (id) => api.get(`/posts/${id}`).then(unwrap).catch(fail);
export const listComments = (postId, { cursor, limit = 50 } = {}) => api.get(`/posts/${postId}/comments`, { params: { cursor, limit } }).then(unwrap).catch(fail);
// Case-insensitive substring search over captions and hashtags (visibility-scoped server-side).
export const searchPosts = (q, { cursor, limit = 20 } = {}) => api.get("/posts/search", { params: { q, cursor, limit } }).then(unwrap).catch(fail);
export const reportPost = (postId, reason, details) => api.post(`/posts/${postId}/report`, { reason, details }).then(unwrap).catch(fail);
// Admin review: reads a post even when it was removed or is not visible to the admin account.
export const adminPost = (postId) => api.get(`/admin/posts/${postId}`).then(unwrap).catch(fail);
// Undo a moderation removal (soft delete -> visible again).
export const adminRestorePost = (postId) => api.post(`/admin/posts/${postId}/restore`).then(unwrap).catch(fail);
export const adminComment = (commentId) => api.get(`/admin/comments/${commentId}`).then(unwrap).catch(fail);
export const adminRestoreComment = (commentId) => api.post(`/admin/comments/${commentId}/restore`).then(unwrap).catch(fail);
// Share/repost: notifies the author (post.shared) and increments the counter.
export const sharePost = (postId, comment) => api.post(`/posts/${postId}/share`, { comment }).then(unwrap).catch(fail);
// Delete one comment (author or the post owner — the server decides).
export const deleteComment = (postId, commentId) => api.delete(`/posts/${postId}/comments/${commentId}`).then(unwrap).catch(fail);
// Discovery row on the search page.
export const listTrendingHashtags = (limit = 10) => api.get("/posts/trending", { params: { limit } }).then(unwrap).catch(fail);

export default { listByAuthor, listBookmarks, listByHashtag, reportPost, listFeed, toggleLike, addComment, createPost, toggleBookmark, getPost, listComments, searchPosts };
