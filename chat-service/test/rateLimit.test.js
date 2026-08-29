import assert from "node:assert/strict";
import test from "node:test";
import { userRateLimit } from "../src/middleware/rateLimit.js";
import { consumeUserRateLimit } from "../src/services/rateLimitService.js";

test("rate limiter creates one Redis sliding window per rule and user", async () => {
  let invocation;
  const client = {
    eval: async (script, options) => {
      invocation = { script, options };
      return [1, 0, 29];
    },
  };

  const result = await consumeUserRateLimit({
    userId: 42,
    action: "socket:message:send",
    rules: [
      { windowMs: 10_000, maxRequests: 30 },
      { windowMs: 300_000, maxRequests: 300 },
    ],
    client,
    now: 1_000,
    member: "request-1",
  });

  assert.deepEqual(result, { allowed: true, retryAfter: 0, remaining: 29 });
  assert.deepEqual(invocation.options, {
    keys: [
      "chat:rate-limit:socket:message:send:10000:user:42",
      "chat:rate-limit:socket:message:send:300000:user:42",
    ],
    arguments: ["1000", "request-1", "10000", "30", "300000", "300"],
  });
  assert.match(invocation.script, /ZREMRANGEBYSCORE/);
});

test("rate limiter returns retry information from Redis", async () => {
  const client = { eval: async () => [0, 7, 0] };
  const result = await consumeUserRateLimit({
    userId: 7,
    action: "rest:sync",
    rules: [{ windowMs: 60_000, maxRequests: 60 }],
    client,
  });

  assert.deepEqual(result, { allowed: false, retryAfter: 7, remaining: 0 });
});

test("rate limiter rejects invalid identities before touching Redis", async () => {
  const client = { eval: async () => assert.fail("Redis must not be called") };
  await assert.rejects(
    consumeUserRateLimit({
      userId: 0,
      action: "rest:sync",
      rules: [{ windowMs: 60_000, maxRequests: 60 }],
      client,
    }),
    /positive userId/
  );
});

test("REST rate limiter returns 429 with retry metadata", async () => {
  const headers = {};
  let status;
  let body;
  const response = {
    set: (name, value) => { headers[name] = value; },
    status: (value) => { status = value; return response; },
    json: (value) => { body = value; return response; },
  };
  const middleware = userRateLimit(
    "sync",
    [{ windowMs: 60_000, maxRequests: 60 }],
    { check: async () => ({ allowed: false, retryAfter: 9, remaining: 0 }) }
  );

  await middleware(
    { user: { userId: 42 } },
    response,
    () => assert.fail("Limited request must not continue")
  );

  assert.equal(status, 429);
  assert.equal(headers["Retry-After"], "9");
  assert.equal(headers["X-RateLimit-Remaining"], "0");
  assert.equal(body.error, "RATE_LIMIT_EXCEEDED");
  assert.equal(body.retryAfter, 9);
});
