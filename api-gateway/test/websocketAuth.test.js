import assert from "node:assert/strict";
import test from "node:test";
import jwt from "jsonwebtoken";

import { authenticateWebSocketUpgrade } from "../src/middleware/websocketAuth.js";

function socketDouble() {
  return {
    writes: [],
    destroyed: false,
    write(value) {
      this.writes.push(value);
    },
    destroy() {
      this.destroyed = true;
    },
  };
}

test("WebSocket authentication accepts an HttpOnly cookie", () => {
  const previousSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = "test-jwt-secret";
  try {
    const token = jwt.sign({ userId: 42, email: "user@example.com" }, process.env.JWT_SECRET);
    const req = {
      url: "/graphql/comment",
      headers: { cookie: `access_token=${token}` },
    };
    const socket = socketDouble();

    assert.equal(authenticateWebSocketUpgrade(req, socket), true);
    assert.equal(req.user.userId, 42);
    assert.equal(socket.destroyed, false);
  } finally {
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
  }
});

test("WebSocket authentication rejects tokens in the URL", () => {
  const previousSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = "test-jwt-secret";
  try {
    const token = jwt.sign({ userId: 42 }, process.env.JWT_SECRET);
    const req = {
      url: `/graphql/comment?access_token=${token}`,
      headers: {},
    };
    const socket = socketDouble();

    assert.equal(authenticateWebSocketUpgrade(req, socket), false);
    assert.equal(socket.destroyed, true);
    assert.match(socket.writes[0], /401 Unauthorized/);
  } finally {
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
  }
});
