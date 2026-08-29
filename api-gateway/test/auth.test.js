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
  const previousIssuer = process.env.JWT_ISSUER;
  const previousAudience = process.env.JWT_AUDIENCE;
  process.env.JWT_SECRET = "test-jwt-secret";
  process.env.JWT_ISSUER = "test-auth";
  process.env.JWT_AUDIENCE = "test-api";

  try {
    const options = { issuer: process.env.JWT_ISSUER, audience: process.env.JWT_AUDIENCE };
    const valid = jwt.sign({ userId: 42, email: "user@example.com" }, process.env.JWT_SECRET, options);
    const invalidUser = jwt.sign({ userId: "not-a-number" }, process.env.JWT_SECRET, options);
    const wrongAudience = jwt.sign({ userId: 42 }, process.env.JWT_SECRET, { ...options, audience: "other" });

    assert.equal(verifyToken(valid).userId, 42);
    assert.equal(verifyToken(invalidUser), null);
    assert.equal(verifyToken(wrongAudience), null);
  } finally {
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
    if (previousIssuer === undefined) delete process.env.JWT_ISSUER;
    else process.env.JWT_ISSUER = previousIssuer;
    if (previousAudience === undefined) delete process.env.JWT_AUDIENCE;
    else process.env.JWT_AUDIENCE = previousAudience;
  }
});
