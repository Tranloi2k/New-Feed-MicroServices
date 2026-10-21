import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test, { beforeEach } from "node:test";
import jwt from "jsonwebtoken";
import { getOAuthConfig } from "../src/config/env.js";
import {
  findOrCreateOAuthUser,
  resetGoogleCertCache,
  usernameBase,
  verifyGoogleIdToken,
  verifyOAuthIdentity,
} from "../src/services/oauthService.js";

const CLIENT_ID = "web-client.apps.googleusercontent.com";
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const publicPem = publicKey.export({ type: "spki", format: "pem" });

function jsonResponse(body, { status = 200, headers = {} } = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function googleToken(claims = {}, { kid = "key-1", expiresIn = 300 } = {}) {
  return jwt.sign(
    {
      sub: "google-123",
      email: "Lan@Example.com",
      email_verified: true,
      name: "Lan Nguyen",
      picture: "https://example.com/lan.png",
      ...claims,
    },
    privateKey,
    {
      algorithm: "RS256",
      keyid: kid,
      audience: CLIENT_ID,
      issuer: "https://accounts.google.com",
      expiresIn,
    }
  );
}

function certFetch(certs = { "key-1": publicPem }) {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    return jsonResponse(certs, { headers: { "cache-control": "public, max-age=600" } });
  };
  return { fetchImpl, calls };
}

beforeEach(() => resetGoogleCertCache());

test("google id tokens are verified against Google's signing certs", async () => {
  const { fetchImpl } = certFetch();
  const identity = await verifyGoogleIdToken(googleToken(), {
    clientIds: [CLIENT_ID],
    fetchImpl,
  });

  assert.deepEqual(identity, {
    provider: "google",
    providerAccountId: "google-123",
    email: "lan@example.com",
    fullName: "Lan Nguyen",
    avatarUrl: "https://example.com/lan.png",
    usernameHint: "lan",
  });
});

test("google certs are cached between verifications", async () => {
  const { fetchImpl, calls } = certFetch();
  await verifyGoogleIdToken(googleToken(), { clientIds: [CLIENT_ID], fetchImpl });
  await verifyGoogleIdToken(googleToken(), { clientIds: [CLIENT_ID], fetchImpl });
  assert.equal(calls.length, 1);
});

test("google tokens for another client, expired or forged are rejected", async () => {
  const { fetchImpl } = certFetch();
  const options = { clientIds: ["other-client"], fetchImpl };
  await assert.rejects(verifyGoogleIdToken(googleToken(), options), {
    code: "OAUTH_INVALID_TOKEN",
    status: 401,
  });

  const valid = { clientIds: [CLIENT_ID], fetchImpl };
  await assert.rejects(
    verifyGoogleIdToken(googleToken({}, { expiresIn: -10 }), valid),
    { code: "OAUTH_INVALID_TOKEN" }
  );

  const { privateKey: attackerKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const forged = jwt.sign({ sub: "x", email_verified: true }, attackerKey, {
    algorithm: "RS256",
    keyid: "key-1",
    audience: CLIENT_ID,
    issuer: "accounts.google.com",
  });
  await assert.rejects(verifyGoogleIdToken(forged, valid), { code: "OAUTH_INVALID_TOKEN" });
  await assert.rejects(verifyGoogleIdToken("", valid), { code: "OAUTH_INVALID_TOKEN" });
});

test("an unknown google key id refetches certs at most once per minute", async () => {
  const { fetchImpl, calls } = certFetch();
  const options = { clientIds: [CLIENT_ID], fetchImpl };
  const unknownKid = googleToken({}, { kid: "rotated" });

  await assert.rejects(verifyGoogleIdToken(unknownKid, options), { code: "OAUTH_INVALID_TOKEN" });
  await assert.rejects(verifyGoogleIdToken(unknownKid, options), { code: "OAUTH_INVALID_TOKEN" });
  assert.equal(calls.length, 1);
});

test("google accounts without a verified email are refused", async () => {
  const { fetchImpl } = certFetch();
  await assert.rejects(
    verifyGoogleIdToken(googleToken({ email_verified: false }), {
      clientIds: [CLIENT_ID],
      fetchImpl,
    }),
    { code: "OAUTH_EMAIL_UNVERIFIED", status: 403 }
  );
});

test("google cert outages surface as provider unavailable", async () => {
  const fetchImpl = async () => {
    throw new TypeError("network down");
  };
  await assert.rejects(
    verifyGoogleIdToken(googleToken(), { clientIds: [CLIENT_ID], fetchImpl }),
    { code: "OAUTH_PROVIDER_UNAVAILABLE", status: 502 }
  );
});

test("google sign-in is enabled only when a client ID is configured", () => {
  assert.deepEqual(getOAuthConfig({}), { google: null });
  assert.deepEqual(getOAuthConfig({ GOOGLE_CLIENT_ID: " , " }), { google: null });
  assert.deepEqual(getOAuthConfig({ GOOGLE_CLIENT_ID: " web , android " }), {
    google: { clientIds: ["web", "android"] },
  });
});

test("unknown or unconfigured providers are rejected", async () => {
  const config = { google: null };
  for (const provider of ["google", "github", "facebook", undefined]) {
    await assert.rejects(verifyOAuthIdentity(provider, {}, { config }), {
      code: "OAUTH_PROVIDER_UNSUPPORTED",
      status: 404,
    });
  }
});

test("verifyOAuthIdentity verifies google id tokens with the configured client IDs", async () => {
  const { fetchImpl } = certFetch();
  const identity = await verifyOAuthIdentity(
    "google",
    { idToken: googleToken() },
    { config: { google: { clientIds: ["android", CLIENT_ID] } }, fetchImpl }
  );
  assert.equal(identity.provider, "google");
  assert.equal(identity.providerAccountId, "google-123");
});

test("usernames derived from providers satisfy the username rules", () => {
  assert.equal(usernameBase("Lan.Nguyen+news"), "lan_nguyen_news");
  assert.equal(usernameBase("ab"), "user_ab");
  assert.equal(usernameBase(""), "user");
  assert.equal(usernameBase("__x.y__"), "x_y");
  assert.equal(usernameBase("a".repeat(60)).length, 25);
  assert.match(usernameBase("Nguyễn Văn"), /^[a-z0-9_]{3,30}$/);
});

function createUserDb({ users = [], accounts = [], failOnce } = {}) {
  let nextId = users.length + 1;
  const userTable = {
    async findUnique({ where }) {
      return users.find((user) => user.username === where.username) ?? null;
    },
    async findFirst({ where }) {
      const email = where.email.equals.toLowerCase();
      return users.find((user) => user.email.toLowerCase() === email) ?? null;
    },
    async create({ data }) {
      if (failOnce) {
        const error = failOnce;
        failOnce = undefined;
        throw error;
      }
      const user = { id: nextId++, ...data };
      users.push(user);
      return user;
    },
  };
  const oAuthAccount = {
    async findUnique({ where }) {
      const key = where.provider_providerAccountId;
      const account = accounts.find(
        (row) => row.provider === key.provider && row.providerAccountId === key.providerAccountId
      );
      return account
        ? { ...account, user: users.find((user) => user.id === account.userId) }
        : null;
    },
    async create({ data }) {
      accounts.push(data);
      return data;
    },
  };
  const db = {
    user: userTable,
    oAuthAccount,
    $transaction: (callback) => callback({ user: userTable, oAuthAccount }),
  };
  return { db, users, accounts };
}

const IDENTITY = {
  provider: "google",
  providerAccountId: "google-123",
  email: "lan@example.com",
  fullName: "Lan Nguyen",
  avatarUrl: null,
  usernameHint: "lan",
};

test("first oauth login creates a password-less user and links the account", async () => {
  const { db, users, accounts } = createUserDb({
    users: [{ id: 1, username: "lan", email: "other@example.com" }],
  });

  const user = await findOrCreateOAuthUser(IDENTITY, db);

  assert.equal(user.email, "lan@example.com");
  assert.equal(user.passwordHash, null);
  assert.match(user.username, /^lan_\d{4}$/);
  assert.equal(users.length, 2);
  assert.deepEqual(accounts, [
    { userId: user.id, provider: "google", providerAccountId: "google-123" },
  ]);
});

test("returning oauth users are found through their linked account", async () => {
  const existing = { id: 1, username: "lan", email: "changed@example.com" };
  const { db, users } = createUserDb({
    users: [existing],
    accounts: [{ userId: 1, provider: "google", providerAccountId: "google-123" }],
  });

  assert.equal(await findOrCreateOAuthUser(IDENTITY, db), existing);
  assert.equal(users.length, 1);
});

test("an existing password account with the same email is not auto-linked", async () => {
  const { db, accounts } = createUserDb({
    users: [{ id: 1, username: "lan", email: "LAN@example.com", passwordHash: "hash" }],
  });

  await assert.rejects(findOrCreateOAuthUser(IDENTITY, db), {
    code: "OAUTH_ACCOUNT_NOT_LINKED",
    status: 409,
  });
  assert.equal(accounts.length, 0);
});

test("a unique-constraint race is retried once", async () => {
  const conflict = Object.assign(new Error("Unique constraint"), { code: "P2002" });
  const { db, users } = createUserDb({ failOnce: conflict });

  const user = await findOrCreateOAuthUser(IDENTITY, db);
  assert.equal(user.username, "lan");
  assert.equal(users.length, 1);
});

test("identities without a usable email are rejected", async () => {
  const { db } = createUserDb();
  await assert.rejects(findOrCreateOAuthUser({ ...IDENTITY, email: "" }, db), {
    code: "OAUTH_INVALID_TOKEN",
  });
});
