import assert from "node:assert/strict";
import test from "node:test";
import jwt from "jsonwebtoken";
import { createApp } from "../src/app.js";

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function proxy(name) {
  const handler = (req, res) => {
    res.json({ name, body: req.body ?? null, user: req.user ?? null });
  };
  handler.upgrade = () => {};
  return handler;
}

function createFakeProxies() {
  return Object.fromEntries(
    [
      "authMe",
      "publicAuth",
      "users",
      "postGraphql",
      "commentGraphql",
      "notifications",
      "chat",
      "media",
      "comments",
      "notificationWebSocket",
      "commentGraphqlWebSocket",
    ].map((name) => [name, proxy(name)])
  );
}

test("app composition keeps public auth allowlisted and internal auth private", async () => {
  const app = createApp({
    proxies: createFakeProxies(),
    rateLimiter: (_req, _res, next) => next(),
    clientUrl: "http://localhost:3000",
  });
  const server = await listen(app);
  const origin = `http://127.0.0.1:${server.address().port}`;

  try {
    const login = await fetch(`${origin}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "user@example.com" }),
    });
    assert.equal(login.status, 200);
    assert.deepEqual(await login.json(), {
      name: "publicAuth",
      body: { email: "user@example.com" },
      user: null,
    });

    const refresh = await fetch(`${origin}/api/auth/refresh`, {
      method: "POST",
    });
    assert.equal(refresh.status, 200);
    assert.equal((await refresh.json()).name, "publicAuth");

    for (const [method, path] of [
      ["POST", "/api/auth/validate-token"],
      ["GET", "/api/auth/internal/users/1"],
      ["POST", "/api/auth/internal/users/1"],
      ["GET", "/api/auth/internal/anything?debug=true"],
    ]) {
      const internal = await fetch(`${origin}${path}`, { method });
      assert.equal(internal.status, 404, `${method} ${path}`);
    }
  } finally {
    await close(server);
  }
});

test("chat REST routes require authentication and preserve parsed JSON", async () => {
  const previousSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = "composition-test-secret";
  const app = createApp({ proxies: createFakeProxies(), rateLimiter: (_req, _res, next) => next(), clientUrl: "http://localhost:3000" });
  const server = await listen(app);
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await fetch(`${origin}/api/chat/conversations`)).status, 401);
    const token = jwt.sign({ userId: 42 }, process.env.JWT_SECRET);
    const response = await fetch(`${origin}/api/chat/conversations`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ type: "direct", memberIds: [12] }),
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.name, "chat");
    assert.deepEqual(body.body, { type: "direct", memberIds: [12] });
  } finally {
    await close(server);
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
  }
});

test("app composition strips forged identity and preserves protected JSON routes", async () => {
  const previousSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = "composition-test-secret";
  const app = createApp({
    proxies: createFakeProxies(),
    rateLimiter: (_req, _res, next) => next(),
    clientUrl: "http://localhost:3000",
  });
  const server = await listen(app);
  const origin = `http://127.0.0.1:${server.address().port}`;

  try {
    const forged = await fetch(`${origin}/api/users/me/profile`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "X-User-Id": "999",
      },
      body: JSON.stringify({ bio: "forged" }),
    });
    assert.equal(forged.status, 401);

    const token = jwt.sign(
      { userId: 42, email: "user@example.com" },
      process.env.JWT_SECRET
    );
    const authenticated = await fetch(`${origin}/api/users/me/profile`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ bio: "hello" }),
    });
    assert.equal(authenticated.status, 200);
    const response = await authenticated.json();
    assert.equal(response.name, "users");
    assert.deepEqual(response.body, { bio: "hello" });
    assert.equal(response.user.userId, 42);
  } finally {
    await close(server);
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
  }
});
