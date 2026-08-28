import assert from "node:assert/strict";
import test from "node:test";
import { enqueueEvent } from "../src/services/eventPublisher.js";

test("enqueueEvent writes an event through the caller transaction", async () => {
  let data;
  const tx = {
    outboxEvent: {
      create(args) {
        data = args.data;
        return Promise.resolve({ id: "event-1", ...args.data });
      },
    },
  };

  const event = await enqueueEvent(tx, "post.created", { postId: 42 }, "request-1");
  assert.equal(event.id, "event-1");
  assert.deepEqual(data, {
    eventType: "post.created",
    payload: { postId: 42 },
    correlationId: "request-1",
  });
});
