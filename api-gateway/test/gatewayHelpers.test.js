import assert from "node:assert/strict";
import test from "node:test";

import { getRateLimitRule } from "../src/config/rateLimitRules.js";
import { getTrustProxySetting } from "../src/config/services.js";
import {
  buildRateLimitKey,
  consumeRateLimit,
} from "../src/middleware/rateLimiter.js";
import {
  handleProxyError,
  restreamBody,
} from "../src/utils/proxyHelpers.js";

test("rate-limit rules classify real auth and GraphQL operations", () => {
  assert.equal(getRateLimitRule("/api/auth/signup").bucket, "auth:signup");
  assert.equal(
    getRateLimitRule("/graphql/post", {
      method: "POST",
      body: { query: "mutation { createPost(input: {}) { success } }" },
    }).bucket,
    "posts:create"
  );
  assert.equal(
    getRateLimitRule("/graphql/comment", {
      method: "POST",
      body: { operationName: "CreateComment", query: "mutation CreateComment { createComment(input: {}) { success } }" },
    }).bucket,
    "comments:create"
  );
});

test("rate-limit keys use a bounded route bucket instead of a raw path", () => {
  assert.equal(
    buildRateLimitKey("127.0.0.1", "posts:create"),
    "rate_limit:posts:create:127.0.0.1"
  );
});

test("consumeRateLimit executes the check and insert atomically", async () => {
  const calls = [];
  const redis = {
    async eval(...args) {
      calls.push(args);
      return [1, 2, 1_000];
    },
  };
  const result = await consumeRateLimit(
    redis,
    "rate_limit:test:ip",
    { windowMs: 60_000, maxRequests: 3 },
    2_000,
    "request-id"
  );

  assert.deepEqual(result, {
    allowed: true,
    count: 2,
    oldestTimestamp: 1_000,
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1], 1);
  assert.equal(calls[0][2], "rate_limit:test:ip");
});

test("restreamBody writes parsed JSON without ending the proxy request", () => {
  const calls = [];
  const proxyReq = {
    removeHeader: (name) => calls.push(["remove", name]),
    setHeader: (name, value) => calls.push(["set", name, value]),
    write: (body) => calls.push(["write", body]),
    end: () => calls.push(["end"]),
  };

  restreamBody(proxyReq, { body: { name: "New Feed" } });

  assert.deepEqual(calls.at(-1), ["write", '{"name":"New Feed"}']);
  assert.equal(calls.some(([operation]) => operation === "end"), false);
});

test("HTTP proxy errors return JSON without destroying the response", () => {
  let destroyed = false;
  let responseBody;
  const res = {
    headersSent: false,
    statusCode: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      responseBody = body;
      this.headersSent = true;
      return this;
    },
    destroy() {
      destroyed = true;
    },
  };

  handleProxyError(new Error("downstream failed"), { url: "/test" }, res, {
    target: "http://service",
    message: "Proxy failed",
  });

  assert.equal(res.statusCode, 502);
  assert.equal(responseBody.message, "Proxy failed");
  assert.equal(destroyed, false);
});

test("trust proxy defaults to false and requires an explicit positive hop count", () => {
  const previous = process.env.TRUST_PROXY_HOPS;
  try {
    delete process.env.TRUST_PROXY_HOPS;
    assert.equal(getTrustProxySetting(), false);
    process.env.TRUST_PROXY_HOPS = "1";
    assert.equal(getTrustProxySetting(), 1);
    process.env.TRUST_PROXY_HOPS = "invalid";
    assert.equal(getTrustProxySetting(), false);
  } finally {
    if (previous === undefined) delete process.env.TRUST_PROXY_HOPS;
    else process.env.TRUST_PROXY_HOPS = previous;
  }
});

