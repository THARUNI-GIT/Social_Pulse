# SocialPulse — Demo Guide & Verification Status

Last verified: 2026-10-15, on branch `main`, gateway published on **http://localhost:8180**
(host port 8080 is taken by an unrelated Java/Jenkins service; `GATEWAY_PORT=8180` in `.env`).

> Superseded documents: `docs/DEMO-READINESS.md` and `docs/SESSION-NOTES.md` were written before the
> Google OAuth work landed and are partly out of date. This file is authoritative.

## 1. Start everything

```powershell
cd T:\socialpulse-platform\socialpulse-platform
docker compose up -d --build
docker compose ps            # wait for every service to report (healthy)
```

The stack: api-gateway (8180), user-service (3003), content-service (3001), chat-service (3002),
notification-service (3004), media-service (3005), postgres, mongodb, redis, rabbitmq, minio,
frontend (5173).

Open the app at **http://localhost:5173**.

Migrations (only needed on a fresh volume):

```powershell
docker compose exec user-service    npx prisma migrate deploy
docker compose exec content-service npx prisma migrate deploy
```

## 2. Health checks

```powershell
docker compose ps                                   # every service reports (healthy)
curl.exe -s http://localhost:8180/health            # {"success":true,"data":{"status":"ok"}}
curl.exe -s -o NUL -w "%{http_code}`n" http://localhost:5173/     # 200
```

## 3. Demonstrate Google sign-in

1. Confirm the server sees the credentials:
   `curl.exe -s http://localhost:8180/auth/google/available` → `{"enabled":true}`.
   If it returns `false`, `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI`
   are missing from the **root** `.env` (docker-compose passes them into the container).
2. On **http://localhost:5173/login** click **Continue with Google**. The browser is sent to
   Google's consent screen; the URL carries `code_challenge_method=S256` and a `state` value.
3. Sign in. You are returned to `/auth/callback?ticket=…`, which exchanges the single-use ticket
   for a session and drops you into the app.
4. In Google Cloud Console the authorized redirect URI must match `GOOGLE_REDIRECT_URI` exactly.
   Both of these work:
   - `http://localhost:8180/auth/google/callback`
   - `http://localhost:8180/api/auth/google/callback`  (alias prefix)

Re-running sign-in with the same Google account re-uses the existing local account (matched on the
verified email) and never creates a duplicate.

## 4. Demonstrate admin moderation

```powershell
# as a normal user: file a report
# then, as `admin`, open http://localhost:5173/admin
```
1. The **Reports** tab lists open reports with the reported target's caption.
2. **Remove content** hides the post everywhere (feed, direct post URL, profile, bookmarks) and the
   row disappears only *after* the server confirms.
3. **Dismiss** clears the report and leaves the post intact.
4. Buttons disable while the request is in flight, so double-clicking cannot submit twice.
5. A non-admin gets `403` and a signed-out user gets `401` from the same endpoint.

## 5. Demonstrate group system messages

1. Open **http://localhost:5173/chat**, create a group with two people.
2. Add a member, rename the group, remove a member.
3. Each action writes a persisted system event: `Alice Rivera added Admin`,
   `Alice Rivera renamed the group to "…"`, `Alice Rivera removed Admin`.
4. Refresh or reopen the group — the events are still there.
5. A non-admin member attempting the same change gets `403` and writes no event.

## 6. Demonstrate upload validation

```powershell
# grab a token (demo account), then exercise the endpoint
$T = (curl.exe -s -X POST http://localhost:8180/auth/login -H "Content-Type: application/json" `
      -d '{"identifier":"alice","password":"password123"}' | ConvertFrom-Json).data.accessToken

# a video under the cap is accepted (returns a presigned POST policy)
curl.exe -s -X POST http://localhost:8180/media/uploads -H "Authorization: Bearer $T" `
  -H "Content-Type: application/json" -d "{\"kind\":\"video\",\"contentType\":\"video/mp4\",\"size\":5242880}"
# a video over the 50MB cap is rejected with 400
curl.exe -s -X POST http://localhost:8180/media/uploads -H "Authorization: Bearer $T" `
  -H "Content-Type: application/json" -d "{\"kind\":\"video\",\"contentType\":\"video/mp4\",\"size\":53477376}"
```
Limits: avatar 2MB, post image 8MB, video 50MB. Allowed: JPEG/PNG/WebP/GIF and
MP4/WebM/MOV/OGG. The storage-side policy also pins content-type and the size range.

## 7. Demonstrate search

Open **http://localhost:5173/search** and use the People / Posts tabs.
Both are case-insensitive, paginated and visibility-scoped: blocked users, private posts and
deleted (moderated) posts never appear. An empty query shows nothing rather than an error.

## 8. Run the automated verification

```powershell
# 70 assertions across all six tasks (waits out the /auth rate limit itself)
node scripts/verify-demo.mjs

# the original 50-assertion integration suite
$env:GATEWAY="http://localhost:8180"; node scripts/e2e.mjs

# read-only demo-account inventory (deletes nothing)
node scripts/cleanup-plan.mjs
```

Expected: `70 passed, 0 failed, 2 skipped` and `50 passed, 0 failed, 0 skipped`.

The 2 skips are honest gaps, not failures:
- completing a live Google consent requires a human with real Google credentials;
- file-signature sniffing of stored objects is not possible with direct-to-storage uploads.

## 9. Backups (Task: safe demo-account cleanup)

```powershell
# create a verified backup of all four datastores
sh scripts/backup-databases.sh        # writes backups/<timestamp>/ + backups/LATEST
```
Backups were verified by restoring into scratch databases and comparing row counts. The cleanup
itself is **not** run automatically — review `docs/CLEANUP-PLAN.md` and approve explicitly first.
