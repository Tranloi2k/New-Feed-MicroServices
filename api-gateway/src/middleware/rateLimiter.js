import { getRedisClient } from "../config/redis.js";
import { getRateLimitRule } from "../config/rateLimitRules.js";
import { logger } from "../utils/logger.js";

/**
 * Leaky Bucket Rate Limiter using Redis
 * 
 * Algorithm:
 * 1. Use Redis Sorted Set to store request timestamps
 * 2. Key format: rate_limit:{ip}:{endpoint}
 * 3. Score is timestamp (for automatic expiry of old requests)
 * 4. Remove requests outside the time window (bucket "leaks")
 * 5. Count remaining requests in bucket
 * 6. Allow if count < maxRequests, reject otherwise
 * 
 * Benefits:
 * - Scalable across multiple API Gateway instances
 * - Accurate rate limiting per IP and endpoint
 * - Automatic cleanup of old entries
 * - No memory issues (Redis handles storage)
 */

export function createRateLimiter() {
  return async (req, res, next) => {
    try {
      const redis = getRedisClient();

      // Get client IP
      const ip = req.ip || req.headers["x-forwarded-for"] || req.connection.remoteAddress;

      // Get rate limit rule for this endpoint
      const rule = getRateLimitRule(req.path);
      const { windowMs, maxRequests, message } = rule;

      // Create unique key for this IP and endpoint
      const key = `rate_limit:${ip}:${req.path}`;

      // Current timestamp
      const now = Date.now();

      // Window start time (requests before this are expired)
      const windowStart = now - windowMs;

      // Use Redis pipeline for atomic operations
      const pipeline = redis.pipeline();

      // 1. Remove expired entries (bucket leak)
      pipeline.zremrangebyscore(key, 0, windowStart);

      // 2. Count current requests in window
      pipeline.zcard(key);

      // 3. Add current request timestamp
      pipeline.zadd(key, now, `${now}-${Math.random()}`);

      // 4. Set key expiration (cleanup)
      pipeline.expire(key, Math.ceil(windowMs / 1000));

      // Execute pipeline
      const results = await pipeline.exec();

      // Get count from second command (zcard)
      const currentRequests = results[1][1];

      // Check if limit exceeded
      if (currentRequests >= maxRequests) {
        // Calculate retry after (seconds until oldest request expires)
        const oldestRequestResult = await redis.zrange(key, 0, 0, "WITHSCORES");
        let retryAfter = Math.ceil(windowMs / 1000);

        if (oldestRequestResult.length >= 2) {
          const oldestTimestamp = parseInt(oldestRequestResult[1]);
          retryAfter = Math.ceil((oldestTimestamp + windowMs - now) / 1000);
        }

        // Remove the request we just added (since we're rejecting it)
        await redis.zrem(key, `${now}-${Math.random()}`);

        // Set rate limit headers
        res.set({
          "X-RateLimit-Limit": maxRequests,
          "X-RateLimit-Remaining": 0,
          "X-RateLimit-Reset": new Date(now + windowMs).toISOString(),
          "Retry-After": retryAfter,
        });

        logger.warn(`Rate limit exceeded for IP ${ip} on ${req.path}`);

        return res.status(429).json({
          success: false,
          error: "RATE_LIMIT_EXCEEDED",
          message: message,
          retryAfter: retryAfter,
        });
      }

      // Set rate limit headers for successful requests
      const remaining = maxRequests - currentRequests - 1;
      res.set({
        "X-RateLimit-Limit": maxRequests,
        "X-RateLimit-Remaining": Math.max(0, remaining),
        "X-RateLimit-Reset": new Date(now + windowMs).toISOString(),
      });

      next();
    } catch (error) {
      // If Redis fails, log error but don't block requests
      logger.error("Rate limiter error:", error);

      // Fail open - allow request to proceed
      next();
    }
  };
}

/**
 * Legacy rate limiter (in-memory, not scalable)
 * Kept for backwards compatibility
 * @deprecated Use createRateLimiter() instead
 */
import rateLimit from "express-rate-limit";

export const rateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: {
    success: false,
    message: "Too many requests from this IP, please try again later",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Helper function to manually reset rate limit for an IP
 * Useful for administrative purposes
 */
export async function resetRateLimit(ip, path = "*") {
  try {
    const redis = getRedisClient();

    if (path === "*") {
      // Reset all rate limits for this IP
      const keys = await redis.keys(`rate_limit:${ip}:*`);
      if (keys.length > 0) {
        await redis.del(...keys);
      }
      logger.info(`Reset all rate limits for IP: ${ip}`);
    } else {
      // Reset specific endpoint for this IP
      const key = `rate_limit:${ip}:${path}`;
      await redis.del(key);
      logger.info(`Reset rate limit for IP: ${ip}, path: ${path}`);
    }

    return true;
  } catch (error) {
    logger.error("Error resetting rate limit:", error);
    return false;
  }
}

/**
 * Get current rate limit status for an IP
 */
export async function getRateLimitStatus(ip, path) {
  try {
    const redis = getRedisClient();
    const rule = getRateLimitRule(path);
    const key = `rate_limit:${ip}:${path}`;

    const now = Date.now();
    const windowStart = now - rule.windowMs;

    // Remove expired entries
    await redis.zremrangebyscore(key, 0, windowStart);

    // Get current count
    const currentRequests = await redis.zcard(key);

    return {
      ip,
      path,
      limit: rule.maxRequests,
      current: currentRequests,
      remaining: Math.max(0, rule.maxRequests - currentRequests),
      resetAt: new Date(now + rule.windowMs).toISOString(),
    };
  } catch (error) {
    logger.error("Error getting rate limit status:", error);
    return null;
  }
}
