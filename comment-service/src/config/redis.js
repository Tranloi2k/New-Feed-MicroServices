import Redis from "ioredis";

let redisClient = null;

/**
 * Create and configure Redis client for Comment Service
 * Uses DB 2 for comment-specific caching
 */
export function createRedisClient() {
    if (redisClient) {
        return redisClient;
    }

    const redisUrl = process.env.REDIS_URL;

    if (!redisUrl) {
        console.warn("⚠️ REDIS_URL not configured, caching disabled");
        return null;
    }

    redisClient = new Redis(redisUrl, {
        db: 2, // Database 2 for Comment Service
        keyPrefix: "comment:", // Auto-prefix all keys with 'comment:'
        maxRetriesPerRequest: 3,
        enableReadyCheck: true,
        retryStrategy(times) {
            const delay = Math.min(times * 50, 2000);
            return delay;
        },
    });

    redisClient.on("connect", () => {
        console.log("✅ Redis connected for Comment Service caching");
    });

    redisClient.on("error", (err) => {
        console.error("❌ Redis connection error:", err);
    });

    redisClient.on("close", () => {
        console.warn("⚠️ Redis connection closed");
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
        console.log("Redis connection closed");
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
