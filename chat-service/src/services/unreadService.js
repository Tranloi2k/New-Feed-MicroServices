import prisma from "../lib/prisma.js";
import { redis } from "../lib/redis.js";

const keyFor = (userId) => `unread:user:${userId}`;
const markerFor = (userId) => `unread:initialized:user:${userId}`;

async function calculateUnread(userId, conversationId, db) {
  const member = await db.conversationMember.findUnique({
    where: { conversationId_userId: { conversationId, userId } },
    select: { lastReadMessageId: true },
  });
  if (!member) return 0;
  return db.message.count({
    where: {
      conversationId,
      senderId: { not: userId },
      deletedAt: null,
      ...(member.lastReadMessageId && { id: { gt: member.lastReadMessageId } }),
    },
  });
}

export async function getUnreadMap(userId, conversationIds, db = prisma) {
  const result = new Map();
  if (!conversationIds.length) return result;
  const cacheReady = await redis.exists(markerFor(userId));
  if (cacheReady) {
    const values = await redis.hmGet(keyFor(userId), conversationIds);
    conversationIds.forEach((id, index) => result.set(id, Number(values[index] || 0)));
    return result;
  }
  const memberships = await db.conversationMember.findMany({
    where: { userId, leftAt: null },
    select: { conversationId: true },
  });
  const allConversationIds = [...new Set([...memberships.map(({ conversationId }) => conversationId), ...conversationIds])];
  const counts = await Promise.all(allConversationIds.map((id) => calculateUnread(userId, id, db)));
  const positive = Object.fromEntries(allConversationIds.map((id, index) => [id, counts[index]]).filter(([, count]) => count > 0));
  if (Object.keys(positive).length) await redis.hSet(keyFor(userId), positive);
  await redis.set(markerFor(userId), "1");
  const allCounts = new Map(allConversationIds.map((id, index) => [id, counts[index]]));
  conversationIds.forEach((id) => result.set(id, allCounts.get(id) || 0));
  return result;
}

export async function incrementUnread(userIds, conversationId) {
  await Promise.all(userIds.map(async (userId) => {
    await redis.hIncrBy(keyFor(userId), conversationId, 1);
    await redis.set(markerFor(userId), "1");
  }));
}

export async function resetUnread(userId, conversationId) {
  await redis.hDel(keyFor(userId), conversationId);
  await redis.set(markerFor(userId), "1");
}
