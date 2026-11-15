# Operations

Notes for running the stack day to day.

## Data and volumes

Compose uses named volumes: `postgres_data`, `mongo_data`, `redis_data`, `rabbitmq_data`, `minio-data`.

`minio-data` holds every uploaded avatar and post image. It is disk-backed, so images survive `docker compose restart minio` and full container recreation.

Never run `docker compose down -v` unless you intend to delete all databases and every uploaded file.

## Migrations

Both Prisma services run `prisma migrate deploy` in their container command, so a fresh volume is migrated on first start. To apply migrations by hand:

```sh
docker compose exec user-service npx prisma migrate deploy
docker compose exec content-service npx prisma migrate deploy
```

## Ports

The gateway is the only backend port published. If 8080 is taken on your machine, set `GATEWAY_PORT` and `PUBLIC_API_URL` in `.env`, then rebuild the frontend, because the API URL is compiled into the bundle:

```sh
docker compose up -d --build frontend
```

MinIO publishes 9000 (API) and 9001 (console). RabbitMQ publishes 15672 (console). Postgres is not published; use `docker compose exec postgres psql -U postgres`.

## Rate limits

The gateway limits `/auth` to 10 requests per minute per IP and everything else to 300. Bulk scripts that log in many times will hit the auth limit; raise `AUTH_RATE_LIMIT_MAX` for the run or wait a minute between runs.

## Media

Buckets and the public-read policy are created by media-service on startup. If uploads fail with a CORS error, check `CORS_ORIGINS` and `MINIO_PUBLIC_URL`: the browser talks to MinIO directly, so that URL must be reachable from the browser, not from inside the container.

## Backups

```sh
sh scripts/backup-databases.sh
```

Writes a Postgres dump and a Mongo archive into `backups/`, which is git-ignored.

`scripts/cleanup-plan.mjs` prints a read-only inventory of accounts and what they own. It deletes nothing.

## Seeding

`socialpulse/scripts/seed-demo.mjs` creates the demo data and uploads real images through the same presigned flow the browser uses. `socialpulse/scripts/reset-demo-data.sh` wipes the volumes and seeds again from scratch.

`seed/init-user-db.sql` is not optional: compose mounts it so the `user_db` database exists on the first Postgres start.

## Logs

```sh
docker compose logs -f --tail=100 api-gateway
```

Each service logs JSON lines with an `x-request-id` that the gateway also returns to the caller.
