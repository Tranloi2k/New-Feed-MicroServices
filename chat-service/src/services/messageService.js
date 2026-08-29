import { monotonicFactory } from "ulid";
import prisma from "../lib/prisma.js";
import { assertMember } from "./conversationService.js";

const TYPES = new Set(["text", "image", "system"]);
const monotonicUlid = monotonicFactory();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function validateMessageInput(input) {
  const conversationId = String(input?.conversationId || "");
  const clientMessageId = String(input?.clientMessageId || "");
  const content = typeof input?.content === "string" ? input.content.trim() : "";
  const type = input?.type || "text";
  const mediaUrl = input?.mediaUrl == null ? null : String(input.mediaUrl);
  if (!conversationId || !UUID.test(clientMessageId)) {
    throw Object.assign(new Error("conversationId and a UUID clientMessageId are required"), { status: 400 });
  }
  if (!TYPES.has(type) || !content || content.length > 10000) {
    throw Object.assign(new Error("Message type or content is invalid"), { status: 400 });
  }
  if (type === "image" && !mediaUrl) {
    throw Object.assign(new Error("mediaUrl is required for image messages"), { status: 400 });
  }
  return { conversationId, clientMessageId, content, type, mediaUrl };
}

export async function createMessage(userId, input, db = prisma) {
  const data = validateMessageInput(input);
  await assertMember(data.conversationId, userId, db);
  try {
    const message = await db.$transaction(async (tx) => {
      const created = await tx.message.create({ data: { id: monotonicUlid(), senderId: userId, ...data } });
      await tx.conversation.update({ where: { id: data.conversationId }, data: { lastMessageAt: created.createdAt } });
      return created;
    });
    return { message, created: true };
  } catch (error) {
    if (error.code !== "P2002") throw error;
    const message = await db.message.findUnique({
      where: { conversationId_clientMessageId: { conversationId: data.conversationId, clientMessageId: data.clientMessageId } },
    });
    if (!message) throw error;
    return { message, created: false };
  }
}

export async function listMessages(userId, conversationId, { before, after, limit = 50 }, db = prisma) {
  await assertMember(conversationId, userId, db);
  if (before && after) throw Object.assign(new Error("Use either before or after, not both"), { status: 400 });
  const take = Math.min(Math.max(Number(limit) || 50, 1), 100);
  const messages = await db.message.findMany({
    where: {
      conversationId,
      deletedAt: null,
      ...(before && { id: { lt: before } }),
      ...(after && { id: { gt: after } }),
    },
    orderBy: { id: after ? "asc" : "desc" },
    take,
  });
  return messages;
}

export async function getRecipients(conversationId, senderId, db = prisma) {
  const now = new Date();
  const members = await db.conversationMember.findMany({
    where: { conversationId, leftAt: null, userId: { not: senderId } },
    select: { userId: true, mutedUntil: true },
  });
  return {
    all: members.map(({ userId }) => userId),
    notify: members.filter(({ mutedUntil }) => !mutedUntil || mutedUntil <= now).map(({ userId }) => userId),
  };
}
