import Redis from "ioredis";
import { logger } from "../utils/logger.js";

let redisClient = null;

export function createRedisClient() {
    if (redisClient) {
        return redisClient;
    }

    const redisUrl = process.env.REDIS_URL;

    redisClient = new Redis(redisUrl, {
        maxRetriesPerRequest: 3,
        enableReadyCheck: true,
        retryStrategy(times) {
            const delay = Math.min(times * 50, 2000);
            return delay;
        },
    });

    redisClient.on("connect", () => {
        logger.info("✅ Redis connected for API Gateway rate limiting");
    });

    redisClient.on("error", (err) => {
        logger.error("❌ Redis connection error:", err);
    });

    redisClient.on("close", () => {
        logger.warn("⚠️ Redis connection closed");
    });

    return redisClient;
}

export function getRedisClient() {
    if (!redisClient) {
        return createRedisClient();
    }
    return redisClient;
}

export async function closeRedisConnection() {
    if (redisClient) {
        await redisClient.quit();
        redisClient = null;
        logger.info("Redis connection closed");
    }
}
