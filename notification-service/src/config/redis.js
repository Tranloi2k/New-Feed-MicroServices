import { createClient } from "redis";

const redis = createClient({ url: process.env.REDIS_URL });
let connecting;
redis.on("error", (error) => console.error("Notification Redis error:", error.message));

async function client() {
  if (redis.isReady) return redis;
  if (!connecting) connecting = redis.connect().finally(() => { connecting = undefined; });
  await connecting;
  return redis;
}

export async function isChatUserOnline(userId) {
  return Boolean(await (await client()).exists(`presence:user:${userId}`));
}
