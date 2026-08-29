import assert from "node:assert/strict";
import test from "node:test";

import { signup } from "../src/controllers/authController.js";
import { getFollowerIdsInternal } from "../src/controllers/profileController.js";

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
