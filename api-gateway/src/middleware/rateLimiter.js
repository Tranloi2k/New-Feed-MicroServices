import { randomUUID } from "node:crypto";
import { getRedisClient } from "../config/redis.js";
import { extractAccessToken, verifyToken } from "./auth.js";
import { getRateLimitRule } from "../config/rateLimitRules.js";
import { logger } from "../utils/logger.js";

const HEALTH_PATHS = new Set(["/health", "/health/circuit-breakers"]);

const CONSUME_REQUEST_SCRIPT = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local member = ARGV[4]

redis.call("ZREMRANGEBYSCORE", key, 0, now - window)
local count = redis.call("ZCARD", key)

if count >= limit then
  local oldest = redis.call("ZRANGE", key, 0, 0, "WITHSCORES")
  return {0, count, oldest[2] or now}
end

redis.call("ZADD", key, now, member)
redis.call("PEXPIRE", key, window)
local oldest = redis.call("ZRANGE", key, 0, 0, "WITHSCORES")
return {1, count + 1, oldest[2] or now}
`;

export function buildRateLimitKey(identity, bucket) {
  return `rate_limit:${bucket}:${identity}`;
}

/**
 * Buckets an authenticated caller by user id rather than IP. Requests that
 * originate from a server (Next.js server actions, for example) all share one
 * egress address, so IP buckets would make every user compete for one quota.
 * Anonymous traffic — login and signup above all — stays keyed by IP.
 */
export function identifyClient(req) {
  const token = extractAccessToken(req);
  const user = token ? verifyToken(token) : null;
  if (user) return `user:${user.userId}`;
  return `ip:${req.ip || req.socket?.remoteAddress || "unknown"}`;
}

export async function consumeRateLimit(
  redis,
  key,
  rule,
  now = Date.now(),
  member = `${now}:${randomUUID()}`
) {
  const result = await redis.eval(
    CONSUME_REQUEST_SCRIPT,
    1,
    key,
    now,
    rule.windowMs,
    rule.maxRequests,
    member
  );

  return {
    allowed: Number(result[0]) === 1,
    count: Number(result[1]),
    oldestTimestamp: Number(result[2]),
  };
}

export function createRateLimiter({ redisProvider = getRedisClient } = {}) {
  return async (req, res, next) => {
    if (HEALTH_PATHS.has(req.path)) return next();

    try {
      const redis = redisProvider();
      const rule = getRateLimitRule(req.path, {
        method: req.method,
        body: req.body,
      });
      const identity = identifyClient(req);
      const key = buildRateLimitKey(identity, rule.bucket);
      const now = Date.now();
      const result = await consumeRateLimit(redis, key, rule, now);
      const resetAt = result.oldestTimestamp + rule.windowMs;
      const remaining = Math.max(0, rule.maxRequests - result.count);

      res.set({
        "X-RateLimit-Limit": rule.maxRequests,
        "X-RateLimit-Remaining": remaining,
        "X-RateLimit-Reset": Math.ceil(resetAt / 1000),
      });

      if (result.allowed) return next();

      const retryAfter = Math.max(1, Math.ceil((resetAt - now) / 1000));
      res.set("Retry-After", retryAfter);
      logger.warn("Rate limit exceeded", { identity, bucket: rule.bucket });

      return res.status(429).json({
        success: false,
        error: "RATE_LIMIT_EXCEEDED",
        message: rule.message,
        retryAfter,
      });
    } catch (error) {
      logger.error("Rate limiter unavailable; request allowed", {
        message: error.message,
      });
      return next();
    }
  };
}
