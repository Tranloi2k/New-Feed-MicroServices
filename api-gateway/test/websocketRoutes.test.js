import assert from "node:assert/strict";
import test from "node:test";
import { resolveWebSocketTarget } from "../src/websocket/websocketRouter.js";

test("WebSocket route matching is exact and does not accept lookalike paths", () => {
  assert.equal(resolveWebSocketTarget("/graphql/comment"), "comment");
  assert.equal(
    resolveWebSocketTarget("/notifications/socket.io/"),
    "notification"
  );
  assert.equal(resolveWebSocketTarget("/graphql/comment-evil"), null);
  assert.equal(resolveWebSocketTarget("/notifications/socket.io-evil"), null);
});
