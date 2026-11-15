#!/usr/bin/env bash
# Back up, then clear test content (posts, comments, reports, notifications, chats) while keeping
# the accounts (admin, alice, bob, carol, dave, emma, frank). Media objects are left in the bucket
# because seeded posts reference newly uploaded files; deleting the bucket would break those.
set -euo pipefail
cd "$(dirname "$0")/../.."   # repo root
STAMP=$(date +%Y%m%d-%H%M%S)
mkdir -p backups
echo "→ backup: backups/postgres-$STAMP.sql.gz"
docker compose exec -T postgres pg_dumpall -U postgres | gzip > "backups/postgres-$STAMP.sql.gz"
echo "→ backup: backups/mongo-$STAMP.gz"
docker compose exec -T mongodb mongodump --archive --gzip > "backups/mongo-$STAMP.gz"
echo "→ clearing content (posts, comments, reactions, reports, hashtags)"
# posts CASCADE takes comments/hashtag links with it; the rest have no FK, so clear them explicitly.
docker compose exec -T postgres psql -U postgres -d content_db -v ON_ERROR_STOP=1 -c 'TRUNCATE TABLE posts CASCADE; TRUNCATE TABLE reports CASCADE;' >/dev/null
docker compose exec -T postgres psql -U postgres -d content_db -c 'DELETE FROM reactions; DELETE FROM bookmarks; DELETE FROM shares; DELETE FROM hashtags;' >/dev/null 2>&1 || true
echo "→ clearing chat + notifications"
docker compose exec -T mongodb mongosh --quiet --eval '
  const chat = db.getSiblingDB("chat_db");
  chat.conversations.deleteMany({});
  chat.messages.deleteMany({});
  db.getSiblingDB("notification_db").notifications.deleteMany({});
' >/dev/null
echo "→ clearing follows (not accounts)"
docker compose exec -T postgres psql -U postgres -d user_db -c 'TRUNCATE TABLE follows CASCADE;' >/dev/null 2>&1 || true
echo "reset complete. Restore with: gunzip -c backups/postgres-$STAMP.sql.gz | docker compose exec -T postgres psql -U postgres"
