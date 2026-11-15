# Environment

All configuration comes from the root `.env`, created from `.env.example`. Compose passes the values it needs into each container. Per-service `.env.example` files next to each service exist for running a service outside Docker.

Never commit `.env`, `.keys/` or any credential. `.gitignore` covers `.env`, `.env.*` (templates excluded), `.keys` and `*.pem`.

`sh scripts/gen-keys.sh` writes a fresh RS256 keypair into `.env`.

## Root variables

| Variable | Default | Purpose |
|---|---|---|
| `JWT_PRIVATE_KEY` | none | RS256 signing key, PEM with `\n` escapes. Required by user-service. |
| `JWT_PUBLIC_KEY` | none | Verification key. Required by gateway, chat and notification services. |
| `GATEWAY_PORT` | `8080` | Host port the gateway is published on. |
| `PUBLIC_API_URL` | `http://localhost:8080` | Browser-facing gateway URL, compiled into the frontend bundle at build time. |
| `APP_ORIGIN` | `http://localhost:5173` | Public web origin used in verification and reset links. Never derived from the request Host. |
| `CORS_ORIGINS` | `http://localhost:5173` | Comma-separated origins allowed by the gateway, the chat socket and the media bucket. |
| `MINIO_PUBLIC_URL` | `http://localhost:9000` | Storage URL the browser uses for uploads and image reads. |
| `MINIO_BUCKET` | `socialpulse-media` | The only bucket media URLs may point at. |
| `SMTP_HOST` | empty | Leave empty to run in console mode: nothing is sent. |
| `SMTP_PORT` | `587` | SMTP port. |
| `SMTP_USER`, `SMTP_PASS` | empty | SMTP credentials. |
| `SMTP_SECURE` | `false` | TLS mode for the SMTP connection. |
| `MAIL_FROM` | `SocialPulse <no-reply@socialpulse.local>` | Sender address. |
| `EMAIL_VERIFY_TTL_HOURS` | `24` | Verification link lifetime. |
| `PASSWORD_RESET_TTL_MINUTES` | `60` | Reset link lifetime. |
| `AUTH_DEV_RETURN_LINKS` | `false` | Local only: returns `devLink` in register and forgot-password responses. Rejected when `NODE_ENV=production`. |
| `GOOGLE_CLIENT_ID` | empty | Google OAuth client id. Blank hides the sign-in button. |
| `GOOGLE_CLIENT_SECRET` | empty | Google OAuth client secret. |
| `GOOGLE_CLIENT_ID_WEB` | empty | Separate web client id, if you use one. |
| `GOOGLE_REDIRECT_URI` | `http://localhost:8080/auth/google/callback` | Must match the URI registered in Google Cloud Console exactly. |
| `COOKIE_SECURE` | `false` | Set true only when the app is served over HTTPS. |
| `RATE_LIMIT_MAX` | `300` | Requests per minute per caller on general routes. |
| `AUTH_RATE_LIMIT_MAX` | `10` | Requests per minute per IP on `/auth`. |

## Compose-only variables

These are read by `docker-compose.yml` and have working defaults:

| Variable | Default |
|---|---|
| `USER_SERVICE_URL` | `http://user-service:3003` |
| `GATEWAY_PORT` | `8080` |

## Per-service files

Each service reads a subset of the same names when run on its own:

- `api-gateway/.env.example`: port, `JWT_PUBLIC_KEY`, `CORS_ORIGINS`, upstream service URLs, rate limits.
- `user-service/.env.example`: database URL, `JWT_PRIVATE_KEY` and `JWT_PUBLIC_KEY`, `APP_ORIGIN`, SMTP block, Google block, token lifetimes.
- `content-service/.env.example`: database URL, RabbitMQ URL, `USER_SERVICE_URL`.
- `chat-service/.env.example`: Mongo URI, Redis URL, RabbitMQ URL, `JWT_PUBLIC_KEY`, `CORS_ORIGINS`, `USER_SERVICE_URL`, MinIO public URL and bucket.
- `notification-service/.env.example`: Mongo URI, RabbitMQ URL, `JWT_PUBLIC_KEY`, `CORS_ORIGINS`.
- `media-service/.env.example`: MinIO endpoint, port, credentials, bucket, public URL.
- `socialpulse/.env.example`: `VITE_API_URL`, `VITE_CHAT_URL`, `VITE_NOTIFY_URL`.

## Rotate these

Any credential that has ever been written into a file outside `.env` should be treated as exposed. Rotate the Google client secret and any SMTP password you have used, then update `.env`.
