import { getRedisClient } from "../config/redis.js";

/**
 * Cache Service for Comment Service
 * 
 * Cache Strategy:
 * - Post comments list: 2 minutes TTL (high read frequency, frequent updates)
 * - Single comment: 10 minutes TTL (less frequent access)
 * 
 * Key Patterns (auto-prefixed with 'comment:'):
 * - post:{postId}:comments:{limit}:{cursor} → Comments list for a post
 * - single:{commentId} → Individual comment data
 */

class CacheService {
    constructor() {
        // Cache TTL configurations (in seconds)
        this.TTL = {
            COMMENTS_LIST: 2 * 60, // 2 minutes
            SINGLE_COMMENT: 10 * 60, // 10 minutes
        };

        // Cache key prefixes (ioredis will auto-add 'comment:')
        this.KEYS = {
            POST_COMMENTS: "post:",
            SINGLE: "single:",
        };
    }

    /**
     * Get cached data
     */
    async get(key) {
        try {
            const redis = getRedisClient();
            if (!redis) return null;

            const data = await redis.get(key);
            return data ? JSON.parse(data) : null;
        } catch (error) {
            console.error(`Cache GET error for key ${key}:`, error.message);
            return null;
        }
    }

    /**
     * Set cached data with TTL
     */
    async set(key, value, ttl) {
        try {
            const redis = getRedisClient();
            if (!redis) {
                console.log("⚠️ Redis client not available, skipping cache set");
                return false;
            }

            await redis.setex(key, ttl, JSON.stringify(value));
            return true;
        } catch (error) {
            console.error(`Cache SET error for key ${key}:`, error.message);
            return false;
        }
    }

    /**
     * Delete cached data
     */
    async del(keys) {
        try {
            const redis = getRedisClient();
            if (!redis) return false;

            if (Array.isArray(keys)) {
                if (keys.length > 0) {
                    await redis.del(...keys);
                }
            } else {
                await redis.del(keys);
            }
            return true;
        } catch (error) {
            console.error(`Cache DEL error for keys ${keys}:`, error.message);
            return false;
        }
    }

    /**
     * Delete keys matching pattern (with scanStream for production safety)
     */
    async delPattern(pattern) {
        try {
            const redis = getRedisClient();
            if (!redis) {
                console.log("⚠️ Redis client not available, skipping cache invalidation");
                return 0;
            }

            console.log(`🔍 Starting cache invalidation with pattern: ${pattern}`);

            const stream = redis.scanStream({
                match: pattern,
                count: 100
            });

            const keysToDelete = [];

            stream.on('data', (keys) => {
                if (keys.length > 0) {
                    keysToDelete.push(...keys);
                }
            });

            await new Promise((resolve, reject) => {
                stream.on('end', resolve);
                stream.on('error', reject);
            });

            if (keysToDelete.length > 0) {
                // Keys from SCAN include full prefix, strip it before DEL
                const keysWithoutPrefix = keysToDelete.map(key => key.replace(/^comment:/, ''));

                const batchSize = 100;
                for (let i = 0; i < keysWithoutPrefix.length; i += batchSize) {
                    const batch = keysWithoutPrefix.slice(i, i + batchSize);
                    await redis.del(...batch);
                }

                console.log(`🗑️ Invalidated ${keysWithoutPrefix.length} cache entries: ${pattern}`);
                return keysWithoutPrefix.length;
            }

            return 0;
        } catch (error) {
            console.error(`Cache DEL pattern error for ${pattern}:`, error.message);
            return 0;
        }
    }

    /**
     * Cache comments list for a post
     */
    async cacheCommentsList(postId, limit, cursor, data) {
        const key = `${this.KEYS.POST_COMMENTS}${postId}:comments:${limit}:${cursor || 'null'}`;
        await this.set(key, data, this.TTL.COMMENTS_LIST);
    }

    /**
     * Get cached comments list for a post
     */
    async getCachedCommentsList(postId, limit, cursor) {
        const key = `${this.KEYS.POST_COMMENTS}${postId}:comments:${limit}:${cursor || 'null'}`;
        return await this.get(key);
    }

    /**
     * Cache single comment data
     */
    async cacheSingleComment(commentId, commentData) {
        const key = `${this.KEYS.SINGLE}${commentId}`;
        await this.set(key, commentData, this.TTL.SINGLE_COMMENT);
    }

    /**
     * Get cached single comment
     */
    async getCachedSingleComment(commentId) {
        const key = `${this.KEYS.SINGLE}${commentId}`;
        return await this.get(key);
    }

    /**
     * Invalidate all comments cache for a specific post
     * Called when a comment is created or deleted
     */
    async invalidatePostComments(postId) {
        // Pattern must include full prefix for scanStream
        const pattern = `comment:${this.KEYS.POST_COMMENTS}${postId}:comments:*`;
        await this.delPattern(pattern);
    }

    /**
     * Invalidate single comment cache
     * Called when a comment is updated or deleted
     */
    async invalidateSingleComment(commentId) {
        const key = `${this.KEYS.SINGLE}${commentId}`;
        await this.del(key);
    }

    /**
     * Invalidate all reply comments when parent is deleted
     */
    async invalidateReplies(replyIds) {
        if (!replyIds || replyIds.length === 0) return true;

        const keys = replyIds.map(id => `${this.KEYS.SINGLE}${id}`);
        await this.del(keys);

        console.log(`🗑️ Invalidated ${replyIds.length} reply comment caches`);
        return true;
    }

    /**
     * Clear all comment-related caches
     * Use with caution - mainly for testing/maintenance
     */
    async clearAllCache() {
        try {
            const redis = getRedisClient();
            if (!redis) return false;

            // With keyPrefix 'comment:', FLUSHDB will only affect DB 2
            await redis.flushdb();
            console.log("🗑️ All comment cache cleared");
            return true;
        } catch (error) {
            console.error("Clear all cache error:", error);
            return false;
        }
    }

    /**
     * Get cache statistics
     */
    async getStats() {
        try {
            const redis = getRedisClient();
            if (!redis) return { connected: false };

            const info = await redis.info("stats");
            return {
                connected: redis.status === "ready",
                info: info,
            };
        } catch (error) {
            console.error("Error getting cache stats:", error);
            return { connected: false, error: error.message };
        }
    }
}

export default new CacheService();
