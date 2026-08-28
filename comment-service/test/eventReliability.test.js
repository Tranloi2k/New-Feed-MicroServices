import assert from "node:assert/strict";
import test from "node:test";
import { enqueueEvent } from "../src/services/eventPublisher.js";
import { processPostEvent } from "../src/services/eventListener.js";

test("comment producer enqueues through the domain transaction", async () => {
  let data;
  const tx = { outboxEvent: { create: ({ data: value }) => { data = value; return value; } } };
  await enqueueEvent(tx, "comment.created", { commentId: 7 });
  assert.equal(data.eventType, "comment.created");
  assert.deepEqual(data.payload, { commentId: 7 });
});

test("post deletion is processed only once", async () => {
  const processed = new Set();
  let deletes = 0;
  const tx = {
    processedEvent: {
      findUnique: ({ where }) => Promise.resolve(processed.has(where.eventId) ? {} : null),
      create: ({ data }) => { processed.add(data.eventId); return Promise.resolve(data); },
    },
    comment: {
      deleteMany: () => { deletes += 1; return Promise.resolve({ count: 2 }); },
    },
  };
  const db = { $transaction: (callback) => callback(tx) };
  const event = { eventId: "event-1", eventType: "post.deleted", version: 1, data: { postId: 9 } };

  assert.equal(await processPostEvent(event, db), true);
  assert.equal(await processPostEvent(event, db), false);
  assert.equal(deletes, 1);
});
