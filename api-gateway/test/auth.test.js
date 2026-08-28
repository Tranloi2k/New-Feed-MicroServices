import assert from "node:assert/strict";
import test from "node:test";
import jwt from "jsonwebtoken";

import {
  extractAccessToken,
  verifyToken,
} from "../src/middleware/auth.js";

test("extractAccessToken accepts an exact Bearer scheme", () => {
  assert.equal(
    extractAccessToken({ cookies: {}, headers: { authorization: "bearer abc" } }),
    "abc"
  );
  assert.equal(
    extractAccessToken({
      cookies: {},
      headers: { authorization: "NotBearer abc" },
    }),
    null
  );
});

test("extractAccessToken gives the httpOnly cookie precedence", () => {
  assert.equal(
    extractAccessToken({
      cookies: { access_token: "cookie-token" },
      headers: { authorization: "Bearer header-token" },
    }),
    "cookie-token"
  );
});

test("verifyToken accepts HS256 tokens with a valid positive user id", () => {
  const previousSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = "test-jwt-secret";

  try {
    const valid = jwt.sign({ userId: 42, email: "user@example.com" }, process.env.JWT_SECRET);
    const invalidUser = jwt.sign({ userId: "not-a-number" }, process.env.JWT_SECRET);

    assert.equal(verifyToken(valid).userId, 42);
    assert.equal(verifyToken(invalidUser), null);
  } finally {
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
  }
});

