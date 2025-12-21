import { getRedisClient } from "../config/redis.js";

/**
 * Cache Service for Post Service
 * Only caches post-related data, NOT user data
 */
class CacheService {
    constructor() {
        // Cache TTL configurations (in seconds)
        this.TTL = {
            POST: 15 * 60, // 15 minutes for single post
            NEWS_FEED: 2 * 60, // 2 minutes for news feed (changes frequently)
        };

        // Cache key prefixes
        this.KEYS = {
            POST: "post:",
            NEWS_FEED: "newsfeed:",
        };
    }

    /**
     * Get cached data
     */
    async get(key) {
        try {
            const redis = getRedisClient();
            const data = await redis.get(key);
            if (data) {
                return JSON.parse(data);
            }
            return null;
        } catch (error) {
            console.error(`Cache GET error for key ${key}:`, error.message);
            return null; // Fail gracefully - return null to query DB
        }
    }

    /**
     * Set cached data with TTL
     */
    async set(key, value, ttl) {
        try {
            const redis = getRedisClient();
            await redis.setex(key, ttl, JSON.stringify(value));
            return true;
        } catch (error) {
            console.error(`Cache SET error for key ${key}:`, error.message);
            return false; // Fail gracefully - don't crash service
        }
    }

    /**
     * Delete cached data
     */
    async del(keys) {
        try {
            const redis = getRedisClient();
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
     * Delete keys matching pattern
     */
    async delPattern(pattern) {
        try {
            const redis = getRedisClient();

            // IMPORTANT: With keyPrefix 'post:', we need to include full pattern
            // Pattern should already include the prefix when called
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
                // Keys from SCAN include full prefix, need to strip it before DEL
                const keysWithoutPrefix = keysToDelete.map(key => key.replace(/^post:/, ''));

                const batchSize = 100;
                for (let i = 0; i < keysWithoutPrefix.length; i += batchSize) {
                    const batch = keysWithoutPrefix.slice(i, i + batchSize);
                    await redis.del(...batch);
                }

                console.log(`🗑️  Invalidated ${keysWithoutPrefix.length} cache entries: ${pattern}`);
                return keysWithoutPrefix.length;
            }
            return 0;
        } catch (error) {
            console.error(`Cache DEL pattern error for ${pattern}:`, error.message);
            return 0;
        }
    }

    /**
     * Cache single post
     */
    async cachePost(postId, post) {
        const key = `${this.KEYS.POST}${postId}`;
        await this.set(key, post, this.TTL.POST);
    }

    /**
     * Get cached post
     */
    async getCachedPost(postId) {
        const key = `${this.KEYS.POST}${postId}`;
        return await this.get(key);
    }

    /**
     * Cache news feed page
     */
    async cacheNewsFeed(limit, cursor, feedData) {
        const key = `${this.KEYS.NEWS_FEED}${limit}:${cursor || "first"}`;
        await this.set(key, feedData, this.TTL.NEWS_FEED);
    }

    /**
     * Get cached news feed page
     */
    async getCachedNewsFeed(limit, cursor) {
        const key = `${this.KEYS.NEWS_FEED}${limit}:${cursor || "first"}`;
        return await this.get(key);
    }

    /**
     * Invalidate post cache (when post is updated/deleted)
     */
    async invalidatePost(postId) {
        const postKey = `${this.KEYS.POST}${postId}`;
        await this.del(postKey);

        // Also invalidate all news feeds since they might contain this post
        await this.invalidateAllNewsFeeds();
    }

    /**
     * Invalidate all news feed caches
     * Called when a new post is created or any post is deleted
     */
    async invalidateAllNewsFeeds() {
        // Pattern must match actual newsfeed cache keys
        const pattern = `${this.KEYS.NEWS_FEED}*`;
        await this.delPattern(pattern);
    }

    /**
     * Get cache statistics
     */
    async getStats() {
        try {
            const redis = getRedisClient();
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
