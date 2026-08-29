import crypto from "node:crypto";
import { ulid } from "ulid";
import prisma from "../lib/prisma.js";
import { redis } from "../lib/redis.js";
import { getUnreadMap } from "./unreadService.js";
import { getUsersByIds } from "./userService.js";

const memberSelect = {
  userId: true,
  role: true,
  joinedAt: true,
  mutedUntil: true,
};

export function participantsHash(userIds) {
  return crypto.createHash("sha256").update([...userIds].sort((a, b) => a - b).join(":"), "utf8").digest("hex");
}

function normalizeIds(memberIds, creatorId) {
  const ids = [...new Set([creatorId, ...(memberIds || []).map(Number)])];
  if (ids.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
    const error = new Error("memberIds must contain positive integers");
    error.status = 400;
    throw error;
  }
  return ids;
}

export async function createConversation(userId, input, db = prisma) {
  const type = input?.type;
  const ids = normalizeIds(input?.memberIds, userId);
  if (type === "direct") {
    if (ids.length !== 2) {
      const error = new Error("A direct conversation requires exactly one other member");
      error.status = 400;
      throw error;
    }
    const hash = participantsHash(ids);
    return db.conversation.upsert({
      where: { participantsHash: hash },
      update: {},
      create: {
        id: ulid(),
        type,
        participantsHash: hash,
        members: { create: ids.map((id) => ({ userId: id, role: "member" })) },
      },
      include: { members: { where: { leftAt: null }, select: memberSelect } },
    });
  }
  if (type !== "group") {
    const error = new Error("type must be direct or group");
    error.status = 400;
    throw error;
  }
  const title = String(input?.title || "").trim();
  if (!title || title.length > 100 || ids.length < 2 || ids.length > 100) {
    const error = new Error("A group requires a title and between 2 and 100 members");
    error.status = 400;
    throw error;
  }
  return db.conversation.create({
    data: {
      id: ulid(),
      type,
      title,
      members: { create: ids.map((id) => ({ userId: id, role: id === userId ? "owner" : "member" })) },
    },
    include: { members: { where: { leftAt: null }, select: memberSelect } },
  });
}

export async function assertMember(conversationId, userId, db = prisma) {
  const cacheKey = `chat:member:${conversationId}:${userId}`;
  if (db === prisma) {
    const cached = await redis.get(cacheKey);
    if (cached) return JSON.parse(cached);
  }
  const member = await db.conversationMember.findUnique({
    where: { conversationId_userId: { conversationId, userId } },
  });
  if (!member || member.leftAt) {
    const error = new Error("Conversation access forbidden");
    error.status = 403;
    throw error;
  }
  if (db === prisma) await redis.set(cacheKey, JSON.stringify(member), { EX: 60 });
  return member;
}

export async function listConversations(userId, { cursor, limit = 20 }, db = prisma) {
  const take = Math.min(Math.max(Number(limit) || 20, 1), 50);
  const cursorDate = cursor ? new Date(cursor) : null;
  if (cursor && Number.isNaN(cursorDate.getTime())) {
    const error = new Error("cursor must be an ISO timestamp");
    error.status = 400;
    throw error;
  }
  const conversations = await db.conversation.findMany({
    where: {
      members: { some: { userId, leftAt: null } },
      ...(cursorDate && { lastMessageAt: { lt: cursorDate } }),
    },
    orderBy: [{ lastMessageAt: "desc" }, { id: "desc" }],
    take,
    include: {
      members: { where: { leftAt: null }, select: memberSelect },
      messages: { where: { deletedAt: null }, orderBy: { id: "desc" }, take: 1 },
    },
  });
  const unread = await getUnreadMap(userId, conversations.map(({ id }) => id), db);
  const profiles = await getUsersByIds([...new Set(conversations.flatMap(({ members }) => members.map(({ userId: id }) => id)))]);
  return conversations.map(({ messages, members, ...conversation }) => ({
    ...conversation,
    members: members.map((member) => ({ ...member, ...(profiles.get(member.userId) || {}) })),
    lastMessage: messages[0] || null,
    unreadCount: unread.get(conversation.id) || 0,
  }));
}

export async function getActiveMemberships(userId, db = prisma) {
  return db.conversationMember.findMany({ where: { userId, leftAt: null }, select: { conversationId: true } });
}
