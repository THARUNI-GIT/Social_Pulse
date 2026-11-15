#!/usr/bin/env sh
# SocialPulse — back up every datastore before any destructive operation.
#
#   sh scripts/backup-databases.sh
#
# Writes backups/<timestamp>/ and records the newest folder in backups/LATEST.
# `backups/` is gitignored so dumps can never be committed.
#
# Restore verification (run after a backup, restores into SCRATCH databases only):
#   docker compose exec -T postgres psql -U postgres -c "create database restore_check"
#   docker compose exec -T postgres pg_restore -U postgres -d restore_check --no-owner < backups/<ts>/user_db.dump
#   docker compose exec -T postgres psql -U postgres -c "drop database restore_check"
#   docker compose exec -T mongodb mongorestore --archive --nsFrom 'chat_db.*' --nsTo 'restore_check.*' < backups/<ts>/chat_db.archive
set -e

STAMP="$(date +%Y%m%d-%H%M%S)"
DIR="backups/$STAMP"
mkdir -p "$DIR"

echo "Backing up into $DIR"

# PostgreSQL: custom-format dumps (compressed, restorable with pg_restore).
for DB in user_db content_db; do
  docker compose exec -T postgres pg_dump -U postgres -Fc "$DB" > "$DIR/$DB.dump"
  echo "  $DB -> $(wc -c < "$DIR/$DB.dump") bytes"
done

# MongoDB: single-file archives, one per database.
for DB in chat_db notification_db; do
  docker compose exec -T mongodb mongodump --quiet --db="$DB" --archive > "$DIR/$DB.archive"
  echo "  $DB -> $(wc -c < "$DIR/$DB.archive") bytes"
done

echo "$STAMP" > backups/LATEST
echo "Done. Newest backup: $DIR (recorded in backups/LATEST)"
echo "NOTE: uploaded media lives in object storage; back it up separately if needed."
