# SocialPulse

A social network with a real-time chat, built as **microservices behind a single API gateway**, with a React (Vite) frontend, two PostgreSQL databases, MongoDB, Redis, RabbitMQ and S3-compatible object storage.

> **Version 1.0** — first complete release. See [CHANGELOG-style release notes](docs/IMPLEMENTATION-2026-10-14.md) and the demo walkthrough below.

---

## Architecture

```mermaid
flowchart LR
  FE[Frontend :5173] -->|REST + WebSocket| GW[api-gateway :8080]
  FE -->|presigned upload / public images| MINIO[(MinIO :9000)]
  GW --> US[user-service :3003]
  GW --> CS[content-service :3001]
  GW --> CH[chat-service :3002]
  GW --> NS[notification-service :3004]
  GW --> MS[media-service :3005]
  US --> PG1[(Postgres user_db)]
  CS --> PG2[(Postgres content_db)]
  CH --> MG[(Mongo chat_db)]
  CH --> RD[(Redis presence)]
  NS --> MG2[(Mongo notification_db)]
  MS --> MINIO
  US & CS & CH -- publish --> MQ{{RabbitMQ app.events}}
  MQ -- consume --> NS
  MQ -- follows --> CS
  MQ -- blocks --> CH
```

- The gateway is the **only** backend port exposed. It verifies the RS256 access token, strips client-supplied `x-user-id` / `x-user-roles`, injects trusted ones, applies per-route rate limits and a CORS allowlist, and proxies REST plus Socket.IO (`/socket.io`, `/notifications/socket.io`).
- Services own their data. Cross-service effects travel as domain events (`user.followed`, `user.blocked`, `post.liked`, `comment.created`, `message.sent`, …) consumed by content, chat and notification services.
- Media never flows through the services: the browser asks media-service for a **presigned POST policy** (which pins content-type and size), uploads straight to MinIO, then stores the resulting public URL on the post/profile. Content-service rejects any `mediaUrls` outside its own bucket.

## Features

**Accounts & security**
- Register / login / logout, RS256 access tokens (15 min) and rotating refresh tokens (hashed, reuse revokes all sessions).
- Email verification with single-use, expiring, hashed tokens + resend cooldown.
- Forgot / reset password, and change password from Settings (signs out other devices).
- Google sign-in (OAuth 2.0 authorization code + PKCE) — enabled automatically when client credentials are configured.
- Admin suspension: suspended accounts are rejected per request by the gateway (`401 SUSPENDED`), not only at login.
- Blocking enforced server-side on REST **and** websockets; feed, profiles, search and DMs all respect it.

**Social feed**
- For-you and Following timelines with cursor pagination.
- Posts with images and video, hashtags, single-post pages, edit caption, delete.
- Likes (reaction picker in chat), comments with counts, bookmarks, share-to-chat.
- Post/comment reporting with reasons, and an admin moderation queue (remove, keep, restore).

**Profiles & discovery**
- Profile with avatar (uploaded to object storage), display name, bio, follower/following counts and lists.
- Follow / unfollow, message button, block from a profile.
- Search: people and posts (case-insensitive substring), trending hashtags, `#tag` + Enter opens a hashtag gallery.

**Chat (Socket.IO)**
- Direct and group conversations: create, rename, add/remove members, leave, system events for every change.
- Message persistence before acknowledgement, `sent → delivered → read` ticks, typing indicators, online/last-seen presence (Redis-backed with pruning for multi-tab), unread badges.
- Emoji reactions, image attachments, share a post into a chat, blocked-contact notices.

**Notifications**
- Live bell badge over a dedicated Socket.IO namespace; grouped likes, comments, shares, follows, messages, moderation outcomes and admin report alerts.

**Media**
- Presigned uploads to MinIO with per-kind limits: avatar 2 MB (jpeg/png/webp), post 8 MB (+gif), video 50 MB (mp4/webm/mov/ogv).
- Bucket policy + CORS configured by media-service on startup so browser uploads work.
- Disk-backed object storage: avatars and post media survive container restarts.

## Technology stack

| Layer | Technology |
|---|---|
| Frontend | React 18, Vite, Tailwind CSS, framer-motion, react-router, socket.io-client, axios, lucide-react |
| API gateway | Node 20, Fastify, `@fastify/http-proxy`, JWT verification, in-memory rate limiting |
| Services | NestJS 10, Prisma (user/content), Mongoose (chat/notification), Zod/class-validator DTOs |
| Data | PostgreSQL 16 (two databases), MongoDB 7, Redis 7, RabbitMQ 3, MinIO (S3) |
| Auth | RS256 JWT, argon2 password hashing, OAuth 2.0 + PKCE (Google) |
| Infra | Docker Compose, multi-stage Dockerfiles, nginx (frontend), GitHub Actions CI |

## Repository layout

```
.
├── api-gateway/            # Fastify gateway: auth, proxying, rate limits, WS upgrade
├── user-service/           # NestJS: accounts, auth, follows, blocks, admin (Prisma/Postgres)
├── content-service/        # NestJS: posts, comments, reactions, bookmarks, moderation (Prisma/Postgres)
├── chat-service/           # NestJS: conversations, messages, presence, blocks (Mongo/Redis/Socket.IO)
├── notification-service/   # NestJS: event-driven notifications (Mongo/Socket.IO)
├── media-service/          # NestJS: presigned upload policies for MinIO
├── socialpulse/            # React frontend (+ scripts/ for demo data and feature checks)
├── seed/                   # legacy demo seeding and Postgres init script
├── scripts/                # key generation, E2E suites, backups, cleanup planner
├── docker-compose.yml      # full local stack
├── docs/                   # implementation notes and known limits
└── CONTRACTS.md            # cross-service API/event contracts
```

## Quick start (Docker)

Prerequisites: Docker Desktop with Compose v2, Node.js 20+ (only for the seed scripts), and a free port 8080.

```sh
cp .env.example .env
sh scripts/gen-keys.sh           # generates the RS256 keypair into .env
docker compose up -d --build
```

Compose brings up Postgres, MongoDB, Redis, RabbitMQ, MinIO and all six Node services plus the nginx-served frontend. Prisma migrations run automatically on service start (`prisma migrate deploy` in the container CMD).

| URL | What |
|---|---|
| http://localhost:5173 | Web app |
| http://localhost:8080 | API gateway (`/health`, `/api/docs` per service on its own port) |
| http://localhost:9000 | Object storage (browser uploads / public media) |
| http://localhost:9001 | MinIO console (`minioadmin` / `minioadmin`) |
| http://localhost:15672 | RabbitMQ management (`guest` / `guest`) |

If port 8080 is taken, set `GATEWAY_PORT` and `PUBLIC_API_URL` in `.env` (e.g. `8180` / `http://localhost:8180`) **and rebuild the frontend**, because the API URL is baked into the bundle at build time:

```sh
docker compose up -d --build frontend
```

## Environment setup

Everything is driven by the root `.env` (created from `.env.example`). Per-service examples live next to each service (`*/​.env.example`) and are only needed when running a service outside Docker.

Key variables:

| Variable | Purpose |
|---|---|
| `JWT_PRIVATE_KEY` / `JWT_PUBLIC_KEY` | RS256 keypair, PEM with `\n` escapes (`scripts/gen-keys.sh` fills these) |
| `GATEWAY_PORT`, `PUBLIC_API_URL` | Published gateway port and the browser-facing copy used by the frontend build |
| `APP_ORIGIN` | Public web origin used to build verification / reset links (never derived from the request Host) |
| `CORS_ORIGINS` | Comma-separated browser origins allowed by the gateway, chat gateway and media bucket |
| `MINIO_PUBLIC_URL`, `MINIO_BUCKET` | Browser-facing storage URL and the single bucket all media must live in |
| `SMTP_*`, `MAIL_FROM` | Transactional email; with no `SMTP_HOST` the service runs in console mode and sends nothing |
| `GOOGLE_CLIENT_ID` / `_SECRET` / `GOOGLE_REDIRECT_URI` | Google sign-in; leave blank to disable the button |
| `RATE_LIMIT_MAX`, `AUTH_RATE_LIMIT_MAX` | Gateway limits (300/min general, 10/min on `/auth`) |
| `AUTH_DEV_RETURN_LINKS` | Local-only: return `devLink` in verification/reset responses |

**Never commit `.env`, `.keys/`, or any credential.** They are git-ignored; rotate any secret that was ever shared outside your machine.

## Database setup

- `postgres` starts with `content_db`; `seed/init-user-db.sql` creates `user_db` on first volume init.
- Schemas live in `user-service/prisma/schema.prisma` and `content-service/prisma/schema.prisma`.
- Migrations are applied automatically by the containers. To run them manually:

```sh
docker compose exec user-service npx prisma migrate deploy
docker compose exec content-service npx prisma migrate deploy
```

- MongoDB databases (`chat_db`, `notification_db`) are created on first write; Redis and RabbitMQ need no schema.

## Demo data

The frontend ships its own seeding tooling (generates images locally, uploads them through the real presign flow):

```sh
bash socialpulse/scripts/reset-demo-data.sh      # backs up, then clears posts/chat/notifications
node socialpulse/scripts/seed-demo.mjs           # 6 people with avatars, 12 posts, chats, 1 report
```

Demo accounts (password `password123`): `alice`, `bob`, `carol`, `dave`, `emma`, `frank`, and `admin` (administrator). The older `seed/seed.sh` path still works for a minimal data set.

Suggested demo flow: sign in as `alice` → create a post with an image → like/comment/bookmark → share it into a chat → open an incognito window as `bob` to show live notifications, typing, presence and read receipts → report a post → switch to `admin` to resolve it (remove/restore) and suspend an account → search people/posts and open a trending hashtag.

## Local development (without Docker)

```sh
# frontend
cd socialpulse && npm install && npm run dev        # VITE_API_URL=http://localhost:8080

# any service (its own .env + infrastructure from compose)
cd user-service && npm install && npm run start:dev
```

Keep Postgres/Mongo/Redis/RabbitMQ/MinIO running via `docker compose up -d postgres mongodb redis rabbitmq minio`.

## Tests and checks

```sh
cd user-service        && npm test        # auth, users, follows, blocks
cd content-service     && npm test        # posts, visibility, moderation, media allowlist
cd chat-service        && npm test        # messages, presence, blocks
cd media-service       && npm test        # upload rules
cd notification-service && npm test       # notification rules
cd api-gateway         && npm test        # auth middleware, proxying
cd socialpulse         && npm run build   # production frontend build
```

With the stack running and demo data seeded:

```sh
GATEWAY=http://localhost:8080 node scripts/e2e.mjs                # end-to-end API checks
GATEWAY=http://localhost:8080 node scripts/verify-demo.mjs        # demo-readiness checks
GATEWAY=http://localhost:8080 node socialpulse/scripts/verify-features.mjs
```

Auth endpoints are rate-limited (10/min per IP); raise `AUTH_RATE_LIMIT_MAX` for bulk script runs, and reseed after running the write-heavy suites.

## Operational notes

- Named volumes keep data across `docker compose down`: `postgres_data`, `mongo_data`, `redis_data`, `rabbitmq_data`, `minio-data`. **`docker compose down -v` deletes all of it, including every uploaded image.**
- Uploaded media is public-read by design (bucket policy grants `s3:GetObject`); uploads and deletes still require signed requests.
- `scripts/backup-databases.sh` dumps Postgres and Mongo; `scripts/cleanup-plan.mjs` prints a dry-run inventory before any account cleanup.
- Email and Google sign-in are the only features that need external credentials. Without them the UI shows an honest setup notice rather than faking success.

## Known limits

See [docs/KNOWN_LIMITS.md](docs/KNOWN_LIMITS.md). Highlights: no video transcoding, notifications are best-effort (at-least-once), and the moderation queue is intentionally simple (no appeal workflow).

## License

Not licensed for redistribution; add a license file before publishing publicly.
