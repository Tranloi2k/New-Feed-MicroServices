import { redis } from "../lib/redis.js";

const keyFor = (userId) => `presence:user:${userId}`;

export async function markOnline(userId) {
  await redis.set(keyFor(userId), "1", { EX: 60 });
}

export async function markOffline(userId) {
  await redis.del(keyFor(userId));
}

export async function setTyping(conversationId, userId, isTyping) {
  const key = `typing:${conversationId}:${userId}`;
  if (isTyping) await redis.set(key, "1", { EX: 5 });
  else await redis.del(key);
}

/** Returns the subset of userIds that currently hold a live presence key. */
export async function getOnlineUserIds(userIds, client = redis) {
  const ids = [...new Set(userIds)].filter((id) => Number.isSafeInteger(id) && id > 0);
  if (!ids.length) return [];
  const values = await client.mGet(ids.map(keyFor));
  return ids.filter((_, index) => values[index] !== null);
}
