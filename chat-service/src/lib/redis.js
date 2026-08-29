import "dotenv/config";
import { createClient } from "redis";

export const redis = createClient({ url: process.env.REDIS_URL });
export const redisSub = redis.duplicate();

for (const client of [redis, redisSub]) {
  client.on("error", (error) => console.error("Redis error:", error.message));
}

export async function connectRedis() {
  await Promise.all([
    redis.isOpen ? Promise.resolve() : redis.connect(),
    redisSub.isOpen ? Promise.resolve() : redisSub.connect(),
  ]);
}

export async function isRedisReady() {
  if (!redis.isReady) return false;
  return (await redis.ping()) === "PONG";
}
