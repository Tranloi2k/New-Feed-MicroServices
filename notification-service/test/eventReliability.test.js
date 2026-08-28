import assert from "node:assert/strict";
import test from "node:test";
import {
  processEventOnce,
  validateEventContract,
} from "../src/services/eventListener.js";

function createHarness() {
  const processed = new Set();
  const notifications = [];
  const emitted = [];
  const processedEvent = {
    findUnique: ({ where }) => Promise.resolve(processed.has(where.eventId) ? {} : null),
    create: ({ data }) => { processed.add(data.eventId); return Promise.resolve(data); },
  };
  const tx = {
    processedEvent,
    notification: {
      create: ({ data }) => {
        const row = { id: `notification-${notifications.length + 1}`, read: false, createdAt: new Date(), ...data };
        notifications.push(row);
        return Promise.resolve(row);
      },
    },
  };
  return {
    processed,
    notifications,
    emitted,
    db: { processedEvent, $transaction: (callback) => callback(tx) },
    io: { to: (room) => ({ emit: (name, payload) => emitted.push({ room, name, payload }) }) },
  };
}

test("a redelivered event creates and emits one notification", async () => {
  const { db, io, notifications, emitted } = createHarness();
  const event = {
    eventId: "event-1",
    eventType: "post.liked",
    version: 1,
    data: { postAuthorId: 2, likedBy: 3, likedByName: "Lan", postId: 10 },
  };

  assert.equal(await processEventOnce(io, event, db), true);
  assert.equal(await processEventOnce(io, event, db), false);
  assert.equal(notifications.length, 1);
  assert.equal(emitted.length, 1);
});

test("post.created resolves recipients and does not resolve them again on redelivery", async () => {
  const { db, io, notifications, emitted } = createHarness();
  let resolutions = 0;
  const resolveFollowerIds = async () => {
    resolutions += 1;
    return [2, 3];
  };
  const event = {
    eventId: "event-post-created",
    eventType: "post.created",
    version: 1,
    data: { postId: 10, userId: 1 },
  };

  assert.equal(await processEventOnce(io, event, db, { resolveFollowerIds }), true);
  assert.equal(await processEventOnce(io, event, db, { resolveFollowerIds }), false);
  assert.equal(resolutions, 1);
  assert.deepEqual(notifications.map(({ userId }) => userId), [2, 3]);
  assert.equal(emitted.length, 2);
});

test("comment.created requires a real post author id", () => {
  assert.throws(
    () => validateEventContract({
      eventId: "event-invalid-comment",
      eventType: "comment.created",
      version: 1,
      data: {
        postId: 10,
        postAuthorId: null,
        comment: { id: 20, authorId: 3 },
      },
    }),
    /Invalid comment\.created contract/
  );
});
