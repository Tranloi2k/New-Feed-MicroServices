import assert from "node:assert/strict";
import test from "node:test";
import { getBcryptRounds, getCookieDomain, getJwtClaims, validateEnv } from "../src/config/env.js";
import {
  normalizeEmail,
  optionalHttpUrl,
  pagination,
  positiveInteger,
  validateEmail,
  validatePassword,
} from "../src/utils/validation.js";

test("normalizes email and rejects invalid credentials input", () => {
  assert.equal(normalizeEmail("  User@Example.COM "), "user@example.com");
  assert.equal(validateEmail("user@example.com"), null);
  assert.match(validateEmail("not-an-email"), /valid email/);
  assert.match(validatePassword("short"), /at least 8/);
  assert.match(validatePassword("😀".repeat(19)), /72 UTF-8 bytes/);
  assert.equal(validatePassword("StrongPass123!"), null);
});

test("validates identifiers, pagination and avatar URLs strictly", () => {
  assert.equal(positiveInteger("12").value, 12);
  assert.ok(positiveInteger("12abc").error);
  assert.deepEqual(pagination({ limit: "50", cursor: "0" }), { limit: 50, cursor: "0" });
  assert.ok(pagination({ limit: "51" }).error);
  assert.equal(optionalHttpUrl("https://cdn.example.com/a.png").error, undefined);
  assert.ok(optionalHttpUrl("javascript:alert(1)").error);
});

test("production configuration requires strong, distinct secrets", () => {
  const previous = { ...process.env };
  try {
    Object.assign(process.env, {
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://test:test@db/test",
      CLIENT_URL: "https://app.example.com",
      JWT_SECRET: "short",
      SERVICE_SECRET: "also-short",
      JWT_ISSUER: "newfeed-auth-service",
      JWT_AUDIENCE: "newfeed-api-gateway",
      BCRYPT_ROUNDS: "10",
      PORT: "3001",
    });
    assert.throws(() => validateEnv(), /JWT_SECRET/);
    process.env.JWT_SECRET = "j".repeat(32);
    process.env.SERVICE_SECRET = "s".repeat(32);
    assert.deepEqual(validateEnv(), { port: 3001 });
    process.env.SERVICE_SECRET = process.env.JWT_SECRET;
    assert.throws(() => validateEnv(), /must be different/);
    process.env.SERVICE_SECRET = "s".repeat(32);
    process.env.BCRYPT_ROUNDS = "9";
    assert.throws(() => getBcryptRounds(), /between 10 and 14/);
  } finally {
    for (const key of Object.keys(process.env)) {
      if (!(key in previous)) delete process.env[key];
    }
    Object.assign(process.env, previous);
  }
});

test("requires explicit JWT issuer and audience", () => {
  const previousIssuer = process.env.JWT_ISSUER;
  const previousAudience = process.env.JWT_AUDIENCE;
  try {
    delete process.env.JWT_ISSUER;
    delete process.env.JWT_AUDIENCE;
    assert.throws(() => getJwtClaims(), /JWT_ISSUER/);
  } finally {
    if (previousIssuer === undefined) delete process.env.JWT_ISSUER;
    else process.env.JWT_ISSUER = previousIssuer;
    if (previousAudience === undefined) delete process.env.JWT_AUDIENCE;
    else process.env.JWT_AUDIENCE = previousAudience;
  }
});

test("validates the optional shared auth cookie domain", () => {
  const previous = process.env.AUTH_COOKIE_DOMAIN;
  try {
    process.env.AUTH_COOKIE_DOMAIN = ".example.com";
    assert.equal(getCookieDomain(), ".example.com");
    process.env.AUTH_COOKIE_DOMAIN = "https://example.com";
    assert.throws(() => getCookieDomain(), /hostname/);
  } finally {
    if (previous === undefined) delete process.env.AUTH_COOKIE_DOMAIN;
    else process.env.AUTH_COOKIE_DOMAIN = previous;
  }
});
