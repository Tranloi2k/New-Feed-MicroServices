import Redis from "ioredis";
import { logger } from "../utils/logger.js";

let redisClient = null;

/**
 * Create and configure Redis client for Auth Service
 * Uses DB 3 for auth-specific caching
 */
export function createRedisClient() {
    if (redisClient) {
        return redisClient;
    }

    const redisUrl = process.env.REDIS_URL;

    if (!redisUrl) {
        logger.warn("redis.disabled");
        return null;
    }

    redisClient = new Redis(redisUrl, {
        db: 3, // Database 3 for Auth Service
        keyPrefix: "auth:", // Auto-prefix all keys with 'auth:'
        maxRetriesPerRequest: 3,
        enableReadyCheck: true,
        retryStrategy(times) {
            const delay = Math.min(times * 50, 2000);
            return delay;
        },
    });

    redisClient.on("connect", () => {
        logger.info("redis.connected");
    });

    redisClient.on("error", (err) => {
        logger.error("redis.error", { error: err });
    });

    redisClient.on("close", () => {
        logger.warn("redis.closed");
    });

    return redisClient;
}

/**
 * Get existing Redis client
 */
export function getRedisClient() {
    if (!redisClient) {
        return createRedisClient();
    }
    return redisClient;
}

/**
 * Close Redis connection gracefully
 */
export async function closeRedisConnection() {
    if (redisClient) {
        await redisClient.quit();
        redisClient = null;
        logger.info("redis.disconnected");
    }
}

/**
 * Health check for Redis connection
 */
export async function checkRedisHealth() {
    try {
        if (!redisClient) {
            return { status: "disabled", message: "Redis not configured" };
        }
        await redisClient.ping();
        return { status: "healthy", message: "Redis connection OK" };
    } catch (error) {
        return { status: "unhealthy", message: error.message };
    }
}
