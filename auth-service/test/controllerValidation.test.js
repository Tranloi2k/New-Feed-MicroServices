import assert from "node:assert/strict";
import test from "node:test";

import { getUsersByIds, resetPassword, signup } from "../src/controllers/authController.js";
import { findUsers, getFollowerIdsInternal, searchUsers } from "../src/controllers/profileController.js";

function responseDouble() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

test("signup rejects malformed input before touching the database", async () => {
  const res = responseDouble();
  await signup({ body: { username: "x", email: "invalid", password: "short" } }, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.success, false);
});

test("internal follower IDs reject non-canonical user identifiers", async () => {
  const res = responseDouble();
  await getFollowerIdsInternal({ params: { id: "1abc" }, query: {} }, res);

  assert.equal(res.statusCode, 400);
  assert.match(res.body.message, /positive integer/);
});

test("user search validates short queries before touching the database", async () => {
  const res = responseDouble();
  await searchUsers({ query: { q: "a" }, user: { userId: 1 } }, res);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.message, /between 2 and 50/);
});

test("user search is case-insensitive, bounded, and excludes the viewer", async () => {
  let args;
  const users = [{ id: 2, username: "lan", fullName: "Lan", avatarUrl: null, bio: null }];
  const db = { user: { findMany: async (input) => { args = input; return users; } } };
  assert.deepEqual(await findUsers("Lan", 1, 8, db), users);
  assert.equal(args.where.id.not, 1);
  assert.equal(args.where.OR[0].username.mode, "insensitive");
  assert.equal(args.take, 8);
});

test("password reset rejects a short password before touching the database", async () => {
  const res = responseDouble();
  await resetPassword({ body: { identifier: "user@example.com", password: "short" } }, res);

  assert.equal(res.statusCode, 400);
  assert.match(res.body.message, /at least 8 characters/);
});

test("password reset requires an identifier", async () => {
  const res = responseDouble();
  await resetPassword({ body: { password: "a-long-enough-password" } }, res);

  assert.equal(res.statusCode, 400);
  assert.match(res.body.message, /required/);
});

test("bulk user lookup rejects malformed and oversized id lists", async () => {
  let res = responseDouble();
  await getUsersByIds({ query: {} }, res);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.message, /ids is required/);

  res = responseDouble();
  await getUsersByIds({ query: { ids: "1,abc,3" } }, res);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.message, /positive integer/);

  res = responseDouble();
  await getUsersByIds({ query: { ids: Array.from({ length: 101 }, (_, i) => i + 1).join(",") } }, res);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.message, /at most 100/);
});
