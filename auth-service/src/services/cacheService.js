import { getRedisClient } from "../config/redis.js";
import { logger } from "../utils/logger.js";

/**
 * Cache Service for Auth Service
 * 
 * Cache Strategy:
 * - User data: 30 minutes TTL (frequently accessed, rarely changed)
 * 
 * Key Patterns (auto-prefixed with 'auth:'):
 * - user:{id} → Full user object
 */

const TTL = {
    USER: 30 * 60, // 30 minutes
};

/**
 * Cache user data
 */
export async function cacheUser(userId, userData) {
    try {
        const redis = getRedisClient();
        if (!redis) return false;

        const key = `user:${userId}`;
        await redis.setex(key, TTL.USER, JSON.stringify(userData));
        return true;
    } catch (error) {
        logger.error("cache.user_write_failed", { error, userId });
        return false;
    }
}

/**
 * Get cached user data
 */
export async function getCachedUser(userId) {
    try {
        const redis = getRedisClient();
        if (!redis) return null;

        const key = `user:${userId}`;
        const cached = await redis.get(key);
        return cached ? JSON.parse(cached) : null;
    } catch (error) {
        logger.error("cache.user_read_failed", { error, userId });
        return null;
    }
}

/**
 * Invalidate user cache
 * Called when user data is updated
 */
export async function invalidateUser(userId) {
    try {
        const redis = getRedisClient();
        if (!redis) return false;

        const key = `user:${userId}`;
        await redis.del(key);
        return true;
    } catch (error) {
        logger.error("cache.user_invalidation_failed", { error, userId });
        return false;
    }
}
