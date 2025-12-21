import { getRedisClient } from "../config/redis.js";

/**
 * Cache Service for Auth Service
 * 
 * Cache Strategy:
 * - User data: 30 minutes TTL (frequently accessed, rarely changed)
 * - User existence checks: 5 minutes TTL (short-lived for consistency)
 * 
 * Key Patterns (auto-prefixed with 'auth:'):
 * - user:{id} → Full user object
 * - user_exists:{username} → Boolean (username exists)
 * - user_exists:{email} → Boolean (email exists)
 */

const TTL = {
    USER: 30 * 60, // 30 minutes
    USER_EXISTS: 5 * 60, // 5 minutes
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
        console.error("Cache user error:", error);
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
        console.error("Get cached user error:", error);
        return null;
    }
}

/**
 * Cache username/email existence check
 */
export async function cacheUserExists(identifier, exists) {
    try {
        const redis = getRedisClient();
        if (!redis) return false;

        const key = `user_exists:${identifier}`;
        await redis.setex(key, TTL.USER_EXISTS, exists ? "1" : "0");
        return true;
    } catch (error) {
        console.error("Cache user exists error:", error);
        return false;
    }
}

/**
 * Check cached username/email existence
 */
export async function getCachedUserExists(identifier) {
    try {
        const redis = getRedisClient();
        if (!redis) return null;

        const key = `user_exists:${identifier}`;
        const cached = await redis.get(key);
        return cached === null ? null : cached === "1";
    } catch (error) {
        console.error("Get cached user exists error:", error);
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
        console.error("Invalidate user error:", error);
        return false;
    }
}

/**
 * Invalidate user existence cache
 * Called after new user registration
 */
export async function invalidateUserExists(identifiers) {
    try {
        const redis = getRedisClient();
        if (!redis) return false;

        const keys = identifiers.map((id) => `user_exists:${id}`);
        if (keys.length > 0) {
            await redis.del(...keys);
        }
        return true;
    } catch (error) {
        console.error("Invalidate user exists error:", error);
        return false;
    }
}

/**
 * Clear all auth-related caches
 * Use with caution - mainly for testing/maintenance
 */
export async function clearAllAuthCache() {
    try {
        const redis = getRedisClient();
        if (!redis) return false;

        // With keyPrefix 'auth:', FLUSHDB will only affect DB 3
        await redis.flushdb();
        console.log("🗑️ All auth cache cleared");
        return true;
    } catch (error) {
        console.error("Clear all auth cache error:", error);
        return false;
    }
}
