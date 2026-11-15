# Implementation Report — 2026-10-14

Bug-fix and feature pass over the existing SocialPulse microservices. Everything below was run
against the real Docker stack on this machine (gateway published on **8180** because Jenkins owns
8080 locally; see `docker-compose.override.yml`).

## Verification results (actually executed)

| Check | Command | Result |
|---|---|---|
| Unit tests, 6 services | `npm test` in each service dir | **61 passed / 0 failed** (baseline was 42) |
| New feature integration suite | `GATEWAY=http://localhost:8180 node scripts/integration-fixes.mjs` | **67 passed / 0 failed** |
| Pre-existing project e2e | `GATEWAY=http://localhost:8180 node scripts/e2e.mjs` | **50 passed / 0 failed** — no regressions |
| Frontend production build | `npm run build` in `socialpulse/` | clean (1993 modules) |
| Migration applied | `_prisma_migrations` in `user_db` | `0003_auth_tokens` applied 2026-10-14 |
| Data preserved | `SELECT count(*) FROM users` after `compose up --build` | 11 rows — named volumes intact |
| Browser walkthrough | login → feed → search → post page → chat → group create → group message → reaction | all worked; two UI bugs found here and fixed (see below) |

## Bugs found and fixed during this pass

1. **Doubled handle + wrong name on every post card** (`@@alice`, author shown as "User").
   `adapters/postAdapter.js` pre-prefixed `@` to `handle` and dropped `displayName`/`username`,
   so post cards rendered `@@handle`. The adapter now passes raw API fields through.
2. **Chat reactions never appeared in the UI** although they were persisted. The
   `message:reaction:update` socket event carried no `conversationId`, so the chat page dropped it
   (`m.conversationId === active.conversationId` was false). The gateway now includes it and the
   page tolerates partial updates with a missing conversation id.
3. **A block could be bypassed for a moment** (reproduced: block → immediate DM returned 200).
   chat-service's block replica is fed by events and is eventually consistent. `assertCanMessage`
   now falls back to an authoritative `POST /users/blocks/check` call on the internal network
   (negative results cached 5s, positives 30s), so the race is closed on every path.

## What changed, by area

### F. Authentication — email verification + password reset (demo-critical)
- `user-service/prisma/schema.prisma` + `migrations/0003_auth_tokens/`: new `AuthToken` model.
- `user-service/src/email/email.service.ts` (new): SMTP transport from env only; console mode when
  `SMTP_HOST` is unset. Never logs tokens.
- `user-service/src/auth/auth.service.ts`: `register` sends a verification link;
  `verifyEmail`, `resendVerification`, `requestPasswordReset`, `resetPassword`. Tokens are 32 random
  bytes, stored only as SHA-256, single-use, expiring (24h / 1h), consumed with a conditional
  update so reuse is safe under concurrency. Reset revokes every refresh token.
- `auth.controller.ts` / `auth.dto.ts`: new routes.
- **Login policy:** unverified accounts may sign in (a demo never dead-ends); the account is flagged
  via `user.verified` and the UI shows a resend banner.
- Gateway `isPublic` allows `verify-email`, `forgot-password`, `reset-password`;
  `resend-verification` requires a session.
- Frontend: `VerifyEmail`, `ForgotPassword`, `ResetPassword` pages; "Forgot password?" link; an
  unverified-email banner with a resend button in `AppLayout`.
- **Local dev path** (no SMTP account needed): `AUTH_DEV_RETURN_LINKS=true` + `NODE_ENV!==production`
  makes register/resend/forgot responses include `devLink`. `forgot-password` never reveals whether
  an address exists.

### E. Search
- `content-service/src/posts/search.ts` (new, unit-tested): `GET /posts/search?q=` — case-insensitive
  substring over the caption plus hashtag match, always ANDed with the visibility predicate, with
  pagination and a capped term length.
- `user-service` search switched from `handle startsWith` to `contains` (both handle and display name,
  case-insensitive), still filtering blocked users in both directions.
- Frontend `Search.jsx`: People/Posts tabs, results link to the exact profile/post.

### D. Real-time chat
- **Reactions picker**: emoji picker on every message; re-picking the same emoji removes the reaction.
- **Unread badge**: chat-service `GET /conversations/unread` (`{total, byConversation}`) plus a
  `ChatUnreadContext` that refreshes on navigation, on a 15s poll and instantly on websocket events;
  the bottom nav shows the count.
- **Redundant nav removed**: the duplicate Chat entry in the header was dropped (chat stays in the
  bottom navigation).
- **Profile links**: participant name/avatar in the chat header open the profile; group message
  bubbles are labelled with the sender.
- **Blocked notice**: attempting to open/start a chat with a blocked contact shows an explicit
  notice instead of the composer.
- **Groups**: `Conversation` gained `name`/`createdBy`/`admins`/`type: group`; new endpoints
  `POST /conversations/group`, `GET|PATCH /conversations/:id`, `GET /conversations/:id/members`,
  `POST /conversations/:id/members`, `DELETE /conversations/:id/members/:userId`; membership
  authorization on every read/write; realtime `conversation:created|updated|removed`; member
  management panel (rename, add, remove, leave). Max 50 members, creator is the first admin.

### B. Uploads and media
- **Video**: `media-service` gained a `video` kind (MP4/WebM/MOV/OGG, 50MB) with a strict MIME
  allowlist enforced by the presigned policy; ownership rules cover the new folder.
- `CreateModal` accepts images *and* videos with client-side type/size pre-checks and a video preview;
  cards and grids render videos with controls (▶ badge in grids).
- Text-only posts send no `mediaUrls` and render no placeholder image.
- Media out of our bucket is still rejected (`INVALID_MEDIA_URL`).

### C. Feed and profiles
- New shared `components/PostCard.jsx`: author name/avatar link to the profile, working
  Follow/Unfollow button (the API now returns `author.isSelf` / `author.isFollowing` from the
  replicated follow graph — no N+1), like, comment with a server re-fetch, bookmark, report.
- New `/post/:id` page; every grid tile and card opens its own post; removed posts show a friendly
  "not available" notice.
- Profile follower/following counters link to real `/profile/:id/followers` and `/following` lists.
- Comment submission now persists and refreshes from `GET /posts/:id/comments`.

## Database migrations required

| Service | Migration | Notes |
|---|---|---|
| user-service | `0003_auth_tokens` | new `auth_tokens` table (unique `token_hash`, FK to `users`) |

Applied automatically by the container's `npx prisma migrate deploy`. No content-service or Mongo
migration is needed (Mongo schema is flexible; new fields have defaults).

## Environment variables

New (all optional — defaults keep the previous behaviour):

| Variable | Default | Purpose |
|---|---|---|
| `APP_ORIGIN` | `http://localhost:5173` | Browser origin used to build verification/reset links |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_SECURE` | unset / 587 / — / — / false | Transactional email transport. Unset = console mode (nothing sent) |
| `MAIL_FROM` | `SocialPulse <no-reply@socialpulse.local>` | From header |
| `AUTH_DEV_RETURN_LINKS` | `false` | **Local dev only.** Echo the emailed link as `devLink`. Never enable in production |
| `EMAIL_VERIFY_TTL_HOURS` / `PASSWORD_RESET_TTL_MINUTES` | `24` / `60` | Token lifetimes |
| `RATE_LIMIT_MAX` / `AUTH_RATE_LIMIT_MAX` | `300` / `10` | Gateway limits (now wired into compose) |
| `AUTH_DEV_RETURN_LINKS`, `AUTH_RATE_LIMIT_MAX` | — | Raise the auth limit when running the integration script |

No external API key is required to run the stack; an SMTP provider is only needed to actually
deliver mail.

## Commands (PowerShell)

```powershell
cd T:\socialpulse-platform\socialpulse-platform

# 1. Keys + env (once)
if (-not (Test-Path .env)) { Copy-Item .env.example .env; sh scripts/gen-keys.sh }

# 2. Build and start everything
docker compose up -d --build

# 3. Seed demo data (also marks demo accounts email-verified)
sh seed/seed.sh

# 4. Verify
$env:GATEWAY = "http://localhost:8180"     # 8080 if Jenkins is not running
node scripts/e2e.mjs
node scripts/integration-fixes.mjs

# 5. UI
start http://localhost:5173
```

To demo email verification/password reset without an inbox:

```powershell
$env:AUTH_DEV_RETURN_LINKS = "true"
docker compose up -d user-service
```
Register a new account → the response/UI exposes a `devLink` → open it. Or point `SMTP_*` at
Mailpit/Mailtrap and read the real email.

## Not verified / remaining

- **Two independent browser sessions** for realtime and blocking were exercised at the API/socket
  level (`scripts/e2e.mjs` opens two sockets) and manually in one browser session; a scripted
  two-browser UI test was **not** written.
- **Group realtime reconnect** after a socket drop was not exercised end-to-end in the UI.
- RabbitMQ still has no outbox, so events published while the broker is down are lost (unchanged).
- No video transcodes/thumbnails: the original file is served as-is.
- Gateway rate limits remain in-memory (per instance). No TLS in the dev stack.
- Comment editing/threaded replies use the existing endpoints but have no dedicated UI beyond the
  flat list.
