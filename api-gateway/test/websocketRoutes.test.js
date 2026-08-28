import assert from "node:assert/strict";
import test from "node:test";
import { getWebSocketTarget } from "../src/websocket/upgradeHandler.js";

test("WebSocket route matching is exact and does not accept lookalike paths", () => {
  assert.equal(getWebSocketTarget("/graphql/comment"), "comment");
  assert.equal(
    getWebSocketTarget("/notifications/socket.io/"),
    "notification"
  );
  assert.equal(getWebSocketTarget("/graphql/comment-evil"), null);
  assert.equal(getWebSocketTarget("/notifications/socket.io-evil"), null);
});

