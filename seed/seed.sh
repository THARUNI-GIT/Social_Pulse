#!/bin/sh
# Run after `docker compose up -d`. Seeds demo users/posts/follows/conversations, promotes "admin"
# and marks the demo accounts email-verified so the demo starts clean. Register a NEW account to
# exercise the email-verification flow.
cd "$(dirname "$0")/.."
node seed/seed.mjs
docker compose exec -T postgres psql -U postgres -d user_db -c "UPDATE users SET roles = ARRAY['user','admin'] WHERE handle = 'admin';"
docker compose exec -T postgres psql -U postgres -d user_db -c "UPDATE users SET verified = true WHERE handle IN ('admin','alice','bob','carol','dave','emma','frank');"
