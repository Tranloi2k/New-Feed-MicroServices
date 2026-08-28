CREATE EXTENSION IF NOT EXISTS "citext";

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "users" GROUP BY lower(trim("email")) HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot normalize emails: case-insensitive duplicates exist';
  END IF;
END $$;

UPDATE "users" SET "email" = lower(trim("email"));
ALTER TABLE "users" ALTER COLUMN "email" TYPE CITEXT USING "email"::citext;

CREATE TABLE "refresh_tokens" (
    "id" TEXT NOT NULL,
    "user_id" INTEGER NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "replaced_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "follow_requests" (
    "follower_id" INTEGER NOT NULL,
    "following_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "follow_requests_pkey" PRIMARY KEY ("follower_id", "following_id")
);

CREATE INDEX "refresh_tokens_user_id_idx" ON "refresh_tokens"("user_id");
CREATE INDEX "refresh_tokens_expires_at_idx" ON "refresh_tokens"("expires_at");
CREATE INDEX "follow_requests_following_id_created_at_idx" ON "follow_requests"("following_id", "created_at");

ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "follow_requests" ADD CONSTRAINT "follow_requests_follower_id_fkey"
  FOREIGN KEY ("follower_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "follow_requests" ADD CONSTRAINT "follow_requests_following_id_fkey"
  FOREIGN KEY ("following_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
