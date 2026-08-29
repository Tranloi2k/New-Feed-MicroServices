CREATE TYPE "ConversationType" AS ENUM ('direct', 'group');
CREATE TYPE "MemberRole" AS ENUM ('owner', 'admin', 'member');
CREATE TYPE "MessageType" AS ENUM ('text', 'image', 'system');

CREATE TABLE "conversations" (
  "id" TEXT NOT NULL,
  "type" "ConversationType" NOT NULL,
  "participants_hash" TEXT,
  "title" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "last_message_at" TIMESTAMP(3),
  CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "conversation_members" (
  "conversation_id" TEXT NOT NULL,
  "user_id" INTEGER NOT NULL,
  "role" "MemberRole" NOT NULL DEFAULT 'member',
  "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_read_message_id" TEXT,
  "muted_until" TIMESTAMP(3),
  "left_at" TIMESTAMP(3),
  CONSTRAINT "conversation_members_pkey" PRIMARY KEY ("conversation_id", "user_id")
);

CREATE TABLE "messages" (
  "id" TEXT NOT NULL,
  "conversation_id" TEXT NOT NULL,
  "sender_id" INTEGER NOT NULL,
  "client_message_id" TEXT NOT NULL,
  "type" "MessageType" NOT NULL DEFAULT 'text',
  "content" TEXT NOT NULL,
  "media_url" TEXT,
  "deleted_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "conversations_participants_hash_key" ON "conversations"("participants_hash");
CREATE INDEX "conversations_last_message_at_idx" ON "conversations"("last_message_at" DESC);
CREATE INDEX "conversation_members_user_id_left_at_idx" ON "conversation_members"("user_id", "left_at");
CREATE UNIQUE INDEX "messages_conversation_id_client_message_id_key" ON "messages"("conversation_id", "client_message_id");
CREATE INDEX "messages_conversation_id_id_idx" ON "messages"("conversation_id", "id" DESC);

ALTER TABLE "conversation_members" ADD CONSTRAINT "conversation_members_conversation_id_fkey"
  FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_fkey"
  FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
