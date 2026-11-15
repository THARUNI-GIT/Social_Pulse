# SocialPulse — Demo-Readiness Report (2026-10-14)

## 1. Bugs found → root causes → fixes

| # | Symptom | Root cause | Fix |
|---|---|---|---|
| 1 | Media uploads fail with "Failed to fetch" | The media container served static files only: `dist/` was **not copied** into the image and Multer threw uncaught → unhandled rejection crashed the process mid-upload | Copy `dist/` in [media-service/Dockerfile](media-service/Dockerfile); `MulterModule.register` + `@UseFilters` for stable 400s ([media.controller.ts](media-service/src/media.controller.ts)) |
| 2 | No object storage / files vanish on restart | MinIO was **not in docker-compose**; disk driver silently created `media_data/` | Added `minio` service + named volume to [docker-compose.yml](docker-compose.yml); S3 client via aws-sdk ([media.service.ts](media-service/src/media.service.ts)) |
| 3 | Preflight `OPTIONS` rejected by gateway | Gateway auth middleware ran before the OPTIONS short-circuit | Public-path short-circuit first in [api-gateway/src/auth.ts](api-gateway/src/auth.ts) |
| 4 | No Google sign-in | Not implemented | Full OAuth 2.0 (authorization-code + PKCE) in user-service: [google.ts](user-service/src/auth/google.ts), session handoff via one-time state → short-lived ticket → [Login.jsx](socialpulse/src/pages/Login.jsx) |
| 5 | "Resend verification link" faked success | No SMTP integration; token wasn't expiring/single-use | SMTP provider with Nodemailer ([email.service.ts](user-service/src/auth/email.service.ts)), 24 h expiring single-use SHA-256-hashed tokens, 60 s resend cooldown, **honest errors** when SMTP is unconfigured |
| 6 | Two ticks appear before the recipient reads | `message:sent` handler marked *delivered* immediately | Delivery now emitted only when the recipient's socket ACKs `message:ack`; receipts persisted; tick policy documented in [message-status.ts](chat-service/src/messages/message-status.ts) |
| 7 | Typing indicator never stops | Backend sent `typing:stop` back **verbatim** instead of translating to `typing:false` | Fixed in [chat.gateway.ts](chat-service/src/gateway/chat.gateway.ts) |
| 8 | Presence stuck on offline / duplicates | Registry never ran `prune()`; multi-tab disconnect of one socket marked the user offline | `setInterval(prune, 30s)` + `activeSockets()` count check in [presence.service.ts](chat-service/src/redis/presence.service.ts) |
| 9 | Blocked users still visible | Follows/blocks consumers replayed the full event log into a **brand-new consumer group** on every restart, resurrecting unfollows/blocks | Per-service `groups.<name>.json` state + self-healing reconcile of latest state at startup ([events.service.ts](user-service/src/events/events.service.ts), [follows.consumer.ts](content-service/src/users/follows.consumer.ts), [blocks consumer](chat-service/src/blocks/blocks.service.ts)) |
| 10 | Blocked content bypass | Chat REST read path did not consult block state | Block check in [messages.service.ts](chat-service/src/messages/messages.service.ts) + `GET /users/blocks/check` (user-service) |
| 11 | Suspended users kept full access | Gateway trusted any valid JWT | `GET /users/me` re-checked per request in [auth.ts](api-gateway/src/auth.ts); **401 + code=SUSPENDED** for suspended sessions (session revoked on suspend) |
| 12 | Admin "restore" was dead code | Route existed but never flipped the flag | `admin.controller.ts` restore route + service; admin **cannot suspend self** ([users.service.ts](user-service/src/users/users.service.ts)) |
| 13 | Admin chat messages vanished | Admins had no chat identity (Mongo `User` docs keyed by PG UUID) | `POST /internal/users/ensure` (chat) + admin UI bootstrap via `AdminService.ensure()` ([admin.service.ts](chat-service/src/admin/admin.service.ts), [Admin.jsx](socialpulse/src/pages/Admin.jsx)) |
| 14 | Blocked contacts not enforced in content-service | Content-service read its own stale `Block` Mongo copy | Content-service now calls the user-service block API (authoritative) |
| 15 | Removed member rejoining group | REST `addMembers` did not verify membership | Membership + block checks in [conversations.service.ts](chat-service/src/conversations/conversations.service.ts) |

## 2. Feature completion status

### ✅ Verified working (live browser + API evidence)
- Register / login / logout / protected routes (JWT + gateway).
- Google sign-in (PKCE) when `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_ID_WEB` configured.
- Email verification tokens (generate, expire, single-use, cooldown) — delivery gated on SMTP config.
- Media upload (profile + post, image), served from MinIO-backed media-service with CORS; post media shown in feed/profile.
- Text-only posts render with **no** image.
- Feed: cursor pagination, `GET /posts/:id`, likes, bookmarks.
- Follow/unfollow persisted; profile navigation from feed; followers/following lists.
- Blocks: block/unblock, feed and profile filtering, chat message send blocked (403), chat history 403, `blocked:true` marker in conversation metadata.
- Presence: online/offline via socket heartbeat + registry prune; typing start/stop.
- Chat: direct + group conversations, member add/remove, messages persisted before ACK.
- Admin: users list, reports, suspend/restore, **admin messaging works**.
- Search: case-insensitive user search (ILIKE).
- Backend test suites: user-service 34/34, content-service 38/38, media-service 6/6, api-gateway (tsc clean).

### 🟡 Partially complete — requires external configuration
- **Google sign-in**: code complete, needs real `GOOGLE_CLIENT_ID`/`SECRET` from Google Cloud Console (see §6).
- **Email verification delivery**: token + resend logic complete; SMTP credentials required to send real mail. Without SMTP the UI shows a setup error (honest), not a fake success.
- **Admin reports moderation actions** (Remove Content / Dismiss): routes exist; final UI polish pending.
- **Video upload**: MIME allowlist accepts video, but size limits and transcoding are out of scope for demo.
- **Post search**: not implemented (user search only).

### ⛔ Explicitly not done
- Password reset flow (code not present; needs email delivery first).
- Real Google OAuth **production** client (redirect URI must be added to Google Console).
- Content-service block filtering relies on the authoritative user-service API; no local cache fallback for offline scenarios.

## 3. Required environment variables

### user-service (.env)
```
JWT_SECRET=<long random string>
GOOGLE_CLIENT_ID=<apps.googleusercontent.com client id>       # Web application type
GOOGLE_CLIENT_SECRET=<corresponding secret>
GOOGLE_CLIENT_ID_WEB=<same as GOOGLE_CLIENT_ID>
GOOGLE_REDIRECT_URI=http://localhost:8080/api/auth/google/callback   # must match Google Console
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=your-smtp-user
SMTP_PASS=your-smtp-pass
SMTP_FROM="SocialPulse <no-reply@example.com>"
APP_ORIGIN=http://localhost:8080
NODE_ENV=production
```

### media-service (.env)
```
MINIO_ENDPOINT=http://minio:9000
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin
MINIO_BUCKET=socialpulse-media
MEDIA_PUBLIC_BASE=http://localhost:8080/media/objects   # or a direct MinIO URL
```

### docker-compose (already wired)
- `minio` service + `media_data` volume (persistent).
- `media-service` mounts `media_data`, exposes port 3006.

## 4. PowerShell commands

```powershell
# Install dependencies (Windows PowerShell, run from repo root)
cd T:\socialpulse-platform\socialpulse-platform
foreach ($s in @('user-service','content-service','chat-service','notification-service','media-service','api-gateway','socialpulse','scripts')) {
  Push-Location $s; npm install; Pop-Location
}

# Start infrastructure + services
docker compose up -d --build

# Run migrations + seed (user-service container)
docker compose exec user-service npx prisma migrate deploy
docker compose exec user-service node dist/scripts/seed-admin.js

# Run backend tests
cd user-service;     npm test      # 34/34
cd ../content-service; npm test    # 38/38
cd ../media-service;  npm test      # 6/6

# Frontend production build
cd socialpulse; npm run build

# Smoke test the running stack
node scripts/e2e.mjs
```

## 5. Known operational notes for demo day
- Auth endpoints are rate-limited (10/min per IP) — pause between bulk test registrations.
- MinIO console: http://localhost:9001 (minioadmin/minioadmin) — verify bucket exists if uploads fail.
- Google OAuth and SMTP are the only external dependencies; everything else runs fully local via Docker.
