import assert from "node:assert/strict";
import test from "node:test";

import { oauthLogin } from "../src/controllers/authController.js";
import { AppError } from "../src/utils/appError.js";

function responseDouble() {
  return {
    statusCode: 200,
    body: undefined,
    cookies: {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
    cookie(name, value, options) {
      this.cookies[name] = { value, options };
      return this;
    },
  };
}

function request({ provider = "google", body = {}, platform } = {}) {
  return {
    params: { provider },
    body,
    get: (header) => (header === "x-client-platform" ? platform : undefined),
  };
}

const USER = {
  id: 7,
  username: "lan",
  email: "lan@example.com",
  fullName: "Lan",
  avatarUrl: null,
};
const SESSION = { user: USER, accessToken: "access", refreshToken: "refresh" };

test("oauth login issues the usual session cookies for a verified identity", async () => {
  let verifiedWith;
  const res = responseDouble();
  await oauthLogin(request({ body: { idToken: "id-token", extra: "ignored" } }), res, {
    verifyIdentity: async (provider, tokens) => {
      verifiedWith = { provider, tokens };
      return { provider, providerAccountId: "1" };
    },
    findOrCreateUser: async () => USER,
    createSession: async (user) => ({ ...SESSION, user }),
  });

  assert.deepEqual(verifiedWith, {
    provider: "google",
    tokens: { idToken: "id-token" },
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.data, {
    userId: 7,
    username: "lan",
    email: "lan@example.com",
    fullName: "Lan",
    avatarUrl: null,
  });
  assert.equal(res.cookies.access_token.value, "access");
  assert.equal(res.cookies.access_token.options.httpOnly, true);
  assert.equal(res.cookies.refresh_token.value, "refresh");
});

test("oauth login returns tokens in the body only to mobile clients", async () => {
  const res = responseDouble();
  await oauthLogin(request({ platform: "mobile" }), res, {
    verifyIdentity: async () => ({}),
    findOrCreateUser: async () => USER,
    createSession: async () => SESSION,
  });

  assert.equal(res.body.data.accessToken, "access");
  assert.equal(res.body.data.refreshToken, "refresh");
});

test("oauth client errors keep their status and code", async () => {
  const res = responseDouble();
  await oauthLogin(request(), res, {
    verifyIdentity: async () => {
      throw new AppError("OAUTH_ACCOUNT_NOT_LINKED", "Already exists", 409);
    },
  });

  assert.equal(res.statusCode, 409);
  assert.deepEqual(res.body, {
    success: false,
    code: "OAUTH_ACCOUNT_NOT_LINKED",
    message: "Already exists",
  });
  assert.deepEqual(res.cookies, {});
});

test("oauth provider outages map to 502 and unexpected errors hide details", async () => {
  let res = responseDouble();
  await oauthLogin(request(), res, {
    verifyIdentity: async () => {
      throw new AppError("OAUTH_PROVIDER_UNAVAILABLE", "OAuth provider is unavailable", 502);
    },
  });
  assert.equal(res.statusCode, 502);
  assert.equal(res.body.message, "OAuth provider is unavailable");

  res = responseDouble();
  await oauthLogin(request(), res, {
    verifyIdentity: async () => ({}),
    findOrCreateUser: async () => {
      throw new Error("connection refused to postgres");
    },
  });
  assert.equal(res.statusCode, 500);
  assert.equal(res.body.message, "OAuth login failed");
});

test("oauth login rejects unconfigured providers without a session", async () => {
  delete process.env.GOOGLE_CLIENT_ID;
  const res = responseDouble();
  await oauthLogin(request({ provider: "google", body: { idToken: "x" } }), res);

  assert.equal(res.statusCode, 404);
  assert.equal(res.body.code, "OAUTH_PROVIDER_UNSUPPORTED");
});
