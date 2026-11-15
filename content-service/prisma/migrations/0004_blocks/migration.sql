-- Local replica of user-service blocks, fed by user.blocked / user.unblocked events.
-- Used to enforce the mutual visibility policy on posts, comments and profile grids.
CREATE TABLE "blocks" (
  "blocker_id" UUID NOT NULL,
  "blocked_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "blocks_pkey" PRIMARY KEY ("blocker_id","blocked_id")
);
CREATE INDEX "blocks_blocked_id_idx" ON "blocks"("blocked_id");
