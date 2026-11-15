# Changelog

## v1.0.0 - 2026-11-15

First release.

Added:
- React frontend: feed with Following tab, post composer with image and video, post pages, profiles, follower lists, search, hashtags, bookmarks, notifications, chat, settings, admin dashboard.
- Fastify API gateway: JWT verification, header stripping, CORS allowlist, per-route rate limits, REST and Socket.IO proxying.
- user-service: registration, login, rotating refresh tokens with reuse revocation, email verification, password reset, change password, Google OAuth 2.0 with PKCE, follows, blocks, admin suspension.
- content-service: posts, comments, reactions, bookmarks, hashtags, follower visibility, reports and moderation actions.
- chat-service: direct and group conversations, reactions, typing indicators, presence, delivery and read receipts, image attachments, post sharing, block enforcement on messages.
- notification-service: notifications built from domain events, delivered over a dedicated Socket.IO namespace.
- media-service: presigned MinIO upload policies with per-kind size and type limits.
- Docker Compose stack, per-service Dockerfiles, demo seeding scripts, GitHub Actions CI.

Tested at release: 106 unit tests across the six services, all passing.
