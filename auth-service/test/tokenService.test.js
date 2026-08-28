import assert from "node:assert/strict";
import test from "node:test";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import {
  ACCESS_TOKEN_TTL_SECONDS,
  REFRESH_TOKEN_TTL_MS,
  clearSessionCookies,
  issueSession,
  revokeSession,
  rotateSession,
  setSessionCookies,
} from "../src/services/tokenService.js";

function matches(row, where) {
  if (where.id !== undefined && row.id !== where.id) return false;
  if (where.userId !== undefined && row.userId !== where.userId) return false;
  if (where.revokedAt === null && row.revokedAt != null) return false;
  if (where.expiresAt?.gt && row.expiresAt <= where.expiresAt.gt) return false;
  return true;
}

function createDb(user) {
  const records = new Map();
  const refreshToken = {
    async create({ data }) {
      const row = { ...data, revokedAt: null, replacedById: null, user };
      records.set(row.id, row);
      return row;
    },
    async findUnique({ where }) {
      return records.get(where.id) ?? null;
    },
    async updateMany({ where, data }) {
      let count = 0;
      for (const [id, row] of records) {
        if (!matches(row, where)) continue;
        records.set(id, { ...row, ...data });
        count += 1;
      }
      return { count };
    },
  };
  const db = {
    refreshToken,
    $transaction: (callback) => callback({ refreshToken }),
  };
  return { db, records };
}

test("issues a 30-minute JWT and stores only a bcrypt refresh secret", async () => {
  process.env.JWT_SECRET = "token-service-test-secret";
  const user = { id: 7, username: "lan", email: "lan@example.com" };
  const { db, records } = createDb(user);
  const before = Date.now();

  const session = await issueSession(user, db);
  const payload = jwt.verify(session.accessToken, process.env.JWT_SECRET, {
    algorithms: ["HS256"],
  });
  assert.equal(payload.exp - payload.iat, ACCESS_TOKEN_TTL_SECONDS);

  const [id, secret] = session.refreshToken.split(".");
  const stored = records.get(id);
  assert.ok(stored);
  assert.notEqual(stored.tokenHash, secret);
  assert.equal(await bcrypt.compare(secret, stored.tokenHash), true);
  assert.ok(stored.expiresAt.getTime() >= before + REFRESH_TOKEN_TTL_MS);
});

test("refresh token is rotated and the previous token cannot be claimed twice", async () => {
  process.env.JWT_SECRET = "token-service-test-secret";
  const user = { id: 8, username: "minh", email: "minh@example.com" };
  const { db, records } = createDb(user);
  const original = await issueSession(user, db);

  const rotated = await rotateSession(original.refreshToken, db);
  assert.ok(rotated);
  assert.notEqual(rotated.refreshToken, original.refreshToken);
  const oldId = original.refreshToken.split(".")[0];
  assert.ok(records.get(oldId).revokedAt instanceof Date);

  assert.equal(await rotateSession(original.refreshToken, db), null);
  const newId = rotated.refreshToken.split(".")[0];
  assert.equal(records.get(newId).revokedAt, null);
});

test("logout revokes the persisted refresh token", async () => {
  process.env.JWT_SECRET = "token-service-test-secret";
  const user = { id: 9, username: "mai", email: "mai@example.com" };
  const { db, records } = createDb(user);
  const session = await issueSession(user, db);

  assert.equal(await revokeSession(session.refreshToken, db), true);
  const id = session.refreshToken.split(".")[0];
  assert.ok(records.get(id).revokedAt instanceof Date);
  assert.equal(await revokeSession(session.refreshToken, db), false);
});

test("auth cookies use the access and refresh lifetimes", () => {
  const cookies = [];
  const cleared = [];
  const res = {
    cookie: (name, value, options) => cookies.push({ name, value, options }),
    clearCookie: (name, options) => cleared.push({ name, options }),
  };
  setSessionCookies(res, { accessToken: "access", refreshToken: "refresh" });
  clearSessionCookies(res);

  assert.equal(cookies[0].options.maxAge, ACCESS_TOKEN_TTL_SECONDS * 1000);
  assert.equal(cookies[1].options.maxAge, REFRESH_TOKEN_TTL_MS);
  assert.equal(cookies[0].options.httpOnly, true);
  assert.equal(cookies[1].options.path, "/api/auth");
  assert.deepEqual(cleared.map(({ name }) => name), ["access_token", "refresh_token"]);
});
