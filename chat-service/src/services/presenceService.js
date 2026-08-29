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
