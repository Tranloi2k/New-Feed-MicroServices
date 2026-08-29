import { randomUUID } from "node:crypto";
import { redis } from "../lib/redis.js";

const CONSUME_LIMITS_SCRIPT = `
local now = tonumber(ARGV[1])
local member = ARGV[2]
local remaining = -1

for index, key in ipairs(KEYS) do
  local window = tonumber(ARGV[index * 2 + 1])
  local limit = tonumber(ARGV[index * 2 + 2])
  redis.call("ZREMRANGEBYSCORE", key, 0, now - window)
  local count = redis.call("ZCARD", key)

  if count >= limit then
    local oldest = redis.call("ZRANGE", key, 0, 0, "WITHSCORES")
    local retryAfter = math.max(1, math.ceil(((tonumber(oldest[2]) or now) + window - now) / 1000))
    return {0, retryAfter, 0}
  end

  local available = limit - count - 1
  if remaining < 0 or available < remaining then
    remaining = available
  end
end

for index, key in ipairs(KEYS) do
  local window = tonumber(ARGV[index * 2 + 1])
  redis.call("ZADD", key, now, member .. ":" .. index)
  redis.call("PEXPIRE", key, window)
end

return {1, 0, remaining}
`;

function rateLimitKey(userId, action, windowMs) {
  return `chat:rate-limit:${action}:${windowMs}:user:${userId}`;
}

export async function consumeUserRateLimit({
  userId,
  action,
  rules,
  client = redis,
  now = Date.now(),
  member = `${now}:${randomUUID()}`,
}) {
  if (!Number.isSafeInteger(userId) || userId <= 0) {
    throw new TypeError("A positive userId is required for rate limiting");
  }
  if (!Array.isArray(rules) || rules.length === 0) {
    throw new TypeError("At least one rate-limit rule is required");
  }

  const keys = rules.map((rule) => rateLimitKey(userId, action, rule.windowMs));
  const args = [
    String(now),
    member,
    ...rules.flatMap((rule) => [String(rule.windowMs), String(rule.maxRequests)]),
  ];
  const result = await client.eval(CONSUME_LIMITS_SCRIPT, {
    keys,
    arguments: args,
  });

  return {
    allowed: Number(result[0]) === 1,
    retryAfter: Number(result[1]),
    remaining: Number(result[2]),
  };
}

export async function checkUserRateLimit(options) {
  try {
    return await consumeUserRateLimit(options);
  } catch (error) {
    console.error("Chat rate limiter unavailable; request allowed:", error.message);
    return { allowed: true, retryAfter: 0, remaining: -1, unavailable: true };
  }
}
