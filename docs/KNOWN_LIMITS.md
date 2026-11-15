# Known Limits

Updated 2026-10-14. Items marked ~~struck~~ were implemented since the original list.

- ~~No group chat support yet (direct conversations only).~~ Implemented: groups with persistent
  members/admins, create/add/remove/leave/rename endpoints, membership authorization, realtime
  `conversation:created|updated|removed` events and a member-management panel.
- Search is plain case-insensitive substring matching over handles, display names, post captions
  and hashtags, with pagination. No fuzzy ranking, typo tolerance, or filters
  (dates, media type, author, visibility).
- ~~Chat reactions only render statically, the UI does not allow picking an emoji.~~
  Implemented: an emoji picker on every message; picking the same emoji again removes the reaction.
- ~~Uploaded media doesn't support video transcodes yet.~~ Video *upload* is now allowed
  (MP4/WebM/MOV/OGG, 50MB, server-enforced MIME + size), but there are no transcodes or
  thumbnails, so the browser plays the original file.
- Posts/media are still not moderated by ML; reports go to the admin queue.
- ~~Email verification / password reset~~ implemented (single-use hashed tokens, expiring).
  Without SMTP configured the service runs in console mode (nothing is sent) - use
  `AUTH_DEV_RETURN_LINKS=true` locally or point `SMTP_*` at a real provider.
- The frontend bakes `VITE_API_URL` in at build time, so changing the gateway port needs a
  `docker compose up -d --build frontend` (see `.env.example`).
- Gateway rate limits are in-memory, so they are per gateway instance, not global.
- Single instance per service and no TLS in the dev stack: RabbitMQ, MongoDB, Redis and MinIO are
  dev defaults with no auth/TLS. Put them behind a private network before deploying anywhere real.
- RabbitMQ now persists to a named volume, but a broker recreate can still lose events that were
  published while it was down (no outbox pattern).
- Google sign-in is implemented (OAuth 2.0 authorization code + PKCE, signed state cookie, verified
  email required before account linking, single-use 2-minute handoff ticket). It needs real
  `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` and a redirect URI registered in Google Cloud Console
  that matches `GOOGLE_REDIRECT_URI` **exactly**. Without them the button renders disabled and
  `/auth/google/available` reports `enabled: false`.
- **Media validation is policy-based, not signature-based.** Uploads go straight to object storage
  with a presigned POST, so the server never sees the bytes: the MinIO policy pins the declared
  `Content-Type` and a `content-length-range`, and `rules.ts` validates kind/type/size before
  signing. A polyglot file labelled `video/mp4` would be stored as one. Adding magic-byte sniffing
  requires proxying uploads through media-service (or a post-upload verification step).
- **Group block policy:** a block between two accounts is mutual for reads (posts, profiles, feed,
  comments, chat history) and refuses new direct messages. Inside a group the conversation is not
  torn apart, but a blocked pair is excluded from live delivery and cannot be added to the same
  group afterwards.
- The API Gateway exposes the auth surface under two prefixes: `/auth/*` (canonical) and
  `/api/auth/*` (alias, kept because Google Cloud Console redirect URIs are commonly registered
  with `/api`). Allow/deny decisions normalise the prefix, so the alias cannot widen access.
