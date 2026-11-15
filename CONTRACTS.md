# SocialPulse Contracts (inferred from existing code)

## Auth
- Access token: JWT RS256 (chat accepts RS256/ES256), verified with `JWT_PUBLIC_KEY` (PEM, `\n`-escaped allowed). Claims: `sub` (user id), `roles` (string[]). Chat also tolerates `userId`/`id`.
- Frontend sends `Authorization: Bearer <token>` (REST) and `socket.handshake.auth.token` (Socket.IO).
- Behind the gateway, services trust headers `x-user-id`, `x-user-roles` (comma-separated). Gateway strips client-supplied copies.

## REST envelope
`{ success: true, data }` / `{ success: false, error: { code, message } }`. Cursor pages: `data = { items, nextCursor }` (query `cursor`, `limit`). Swagger at `/api/docs`, health at `/health`.

## Content-service (3001) routes in use
GET/POST /posts, GET /posts/search?q=, GET /posts/:id, PATCH/DELETE /posts/:id, POST|DELETE /posts/:id/reactions, POST /posts/:id/comments, GET /posts/:id/comments, POST /posts/:id/share, POST|DELETE /posts/:id/bookmark, bookmarks list, by-hashtag list.
Post JSON: `{ id, author, caption, tags[], mediaUrls[], visibility(public|followers|private), likes, isLiked, commentsCount, comments[{id,user,text}], createdAt }`.
`author` also carries `isSelf` and `isFollowing` (computed from the replicated follow graph) so the
feed can render a correct Follow/Unfollow button. Search is case-insensitive substring over the
caption and hashtag, always ANDed with the caller's visibility predicate.

## Media-service (3005)
POST /media/uploads {kind: avatar|post|video, contentType, size} -> presigned POST.
Allowlists: avatar 2MB jpeg/png/webp; post 8MB +gif; video 50MB mp4/webm/mov/ogv.
DELETE /media {key} only for the caller's own `kind/<userId>/` folder.

## Auth endpoints (public unless noted)
POST /auth/register, /auth/login, /auth/refresh, /auth/logout,
POST /auth/verify-email {token}, POST /auth/forgot-password {email},
POST /auth/reset-password {token, password},
POST /auth/resend-verification (authenticated).
Verification/reset tokens are 32 random bytes, stored only as SHA-256, single-use and expiring
(24h / 1h). `forgot-password` always answers `{ sent: true }` (no account discovery) and reset
revokes every refresh token. Login is allowed before verification; the account is flagged via
`user.verified` and the UI shows a resend banner.
When `NODE_ENV !== production` and `AUTH_DEV_RETURN_LINKS=true`, register/resend/forgot responses
also carry `devLink` so the flow can be tested without SMTP.

## Chat-service (3002)
REST: POST /conversations/direct/:otherId, POST /conversations/group {name,memberIds},
GET /conversations, GET /conversations/unread -> {total, byConversation},
GET /conversations/:id (membership-checked), GET /conversations/:id/members,
POST /conversations/:id/members {memberIds} (admin), DELETE /conversations/:id/members/:userId
(admin or self), PATCH /conversations/:id {name} (admin), GET /conversations/:id/messages.
Conversation JSON adds `type` (direct|group), `name`, `members[]`, `admins[]`, `createdBy`.
Groups are capped at 50 members; the creator is the first admin; removing an admin's last admin
promotes the longest-standing member.
Socket client->server: `conversation:join|leave {conversationId}`, `message:send {conversationId,type,content}`, `message:typing:start|stop {conversationId}`, `message:read {conversationId,messageId}`, `message:react {messageId,emoji}`, `message:unreact {messageId}`.
Socket server->client: `message:new {message}`, `conversation:updated {conversation}`, `conversation:created {conversation}`, `conversation:removed {conversationId}`, `message:typing {conversationId,userId,isTyping}`, `message:read:update {conversationId,messageId,userId,readAt}`, `message:reaction:update {messageId,reactions}`, `presence:update {userId,status,lastSeenAt}`, `error {code,message}`.
Rooms: `user:{id}`, `conv:{id}`. Status: sent -> delivered -> read (forward only). Redis: `presence:{id}` TTL 60s, channel `presence-events`, `typing:{conv}:{user}` TTL 5s.

## Events (topic exchange `app.events`, JSON body, routing key = event name)
| Event | Payload |
|---|---|
| post.created | postId, authorId, caption, tags[], mediaUrls, visibility, createdAt |
| post.deleted | postId, authorId |
| post.liked | postId, authorId, userId, reactionType, likesCount |
| post.shared | shareId, postId, authorId, userId, comment, sharesCount |
| comment.created | (not provided) assumed: commentId, postId, postAuthorId, authorId, content |
| message.sent | (not provided) assumed: messageId, conversationId, senderId, recipientIds[], preview |
| conversation.created | (not provided) assumed: conversationId, participantIds[], type |
| user.registered (new) | userId, handle, displayName, createdAt |
| user.followed (new) | followerId, followingId, createdAt |
| user.unfollowed (new) | followerId, followingId |

## User batch lookup (new, user-service)
`POST /users/batch {ids:[]}` -> `data: [{ id, username, displayName, handle, avatarUrl, verified }]`. `username` = handle (content-service reads `.username`).
