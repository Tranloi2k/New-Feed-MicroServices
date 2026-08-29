ALTER TABLE "refresh_tokens" ADD COLUMN "family_id" TEXT;
UPDATE "refresh_tokens" SET "family_id" = "id" WHERE "family_id" IS NULL;
ALTER TABLE "refresh_tokens" ALTER COLUMN "family_id" SET NOT NULL;

CREATE INDEX "refresh_tokens_family_id_idx" ON "refresh_tokens"("family_id");

CREATE INDEX "follows_following_id_created_at_follower_id_idx"
  ON "follows"("following_id", "created_at" DESC, "follower_id" DESC);
CREATE INDEX "follows_follower_id_created_at_following_id_idx"
  ON "follows"("follower_id", "created_at" DESC, "following_id" DESC);
CREATE INDEX "follow_requests_following_id_created_at_follower_id_idx"
  ON "follow_requests"("following_id", "created_at" DESC, "follower_id" DESC);
