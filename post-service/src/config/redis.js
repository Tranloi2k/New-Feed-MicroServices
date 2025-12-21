import Redis from "ioredis";

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
        reconnectOnError(err) {
            const targetError = "READONLY";
            if (err.message.includes(targetError)) {
                return true;
            }
            return false;
        },
    });

    redisClient.on("connect", () => {
        console.log("✅ Redis connected for Post Service caching");
    });

    redisClient.on("error", (err) => {
        console.error("❌ Redis connection error:", err.message);
    });

    redisClient.on("close", () => {
        console.warn("⚠️ Redis connection closed");
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
        console.log("Redis connection closed");
    }
}
