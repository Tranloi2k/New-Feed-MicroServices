import assert from "node:assert/strict";
import test from "node:test";
import { getBcryptRounds, validateEnv } from "../src/config/env.js";
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
  assert.deepEqual(pagination({ limit: "50", cursor: "0" }), { limit: 50, cursor: 0 });
  assert.ok(pagination({ limit: "51" }).error);
  assert.equal(optionalHttpUrl("https://cdn.example.com/a.png").error, undefined);
  assert.ok(optionalHttpUrl("javascript:alert(1)").error);
});

test("production configuration rejects weak or placeholder secrets", () => {
  const previous = { ...process.env };
  try {
    Object.assign(process.env, {
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://test:test@db/test",
      CLIENT_URL: "https://app.example.com",
      JWT_SECRET: "short",
      SERVICE_SECRET: "also-short",
      BCRYPT_ROUNDS: "10",
      PORT: "3001",
    });
    assert.throws(() => validateEnv(), /JWT_SECRET/);
    process.env.JWT_SECRET = "j".repeat(32);
    process.env.SERVICE_SECRET = "s".repeat(32);
    assert.deepEqual(validateEnv(), { port: 3001 });
    process.env.BCRYPT_ROUNDS = "9";
    assert.throws(() => getBcryptRounds(), /between 10 and 14/);
  } finally {
    for (const key of Object.keys(process.env)) {
      if (!(key in previous)) delete process.env[key];
    }
    Object.assign(process.env, previous);
  }
});
