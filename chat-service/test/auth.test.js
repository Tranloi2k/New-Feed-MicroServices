import assert from "node:assert/strict";
import test from "node:test";
import jwt from "jsonwebtoken";
import { extractSocketToken } from "../src/middleware/socketAuth.js";
import { verifyAccessToken } from "../src/middleware/auth.js";

test("Socket.IO authentication reads the HttpOnly access cookie", () => {
  assert.equal(
    extractSocketToken({ headers: { cookie: "theme=dark; access_token=abc%2Edef" }, auth: {} }),
    "abc.def"
  );
});

test("JWT validation accepts only positive server user ids", () => {
  const previous = process.env.JWT_SECRET;
  process.env.JWT_SECRET = "chat-auth-test-secret";
  try {
    assert.equal(verifyAccessToken(jwt.sign({ userId: 7 }, process.env.JWT_SECRET)).userId, 7);
    assert.equal(verifyAccessToken(jwt.sign({ userId: 0 }, process.env.JWT_SECRET)), null);
  } finally {
    if (previous === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previous;
  }
});
