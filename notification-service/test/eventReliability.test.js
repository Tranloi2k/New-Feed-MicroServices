import assert from "node:assert/strict";
import test from "node:test";
import { processEventOnce } from "../src/services/eventListener.js";

test("a redelivered event creates and emits one notification", async () => {
  const processed = new Set();
  const notifications = [];
  const emitted = [];
  const tx = {
    processedEvent: {
      findUnique: ({ where }) => Promise.resolve(processed.has(where.eventId) ? {} : null),
      create: ({ data }) => { processed.add(data.eventId); return Promise.resolve(data); },
    },
    notification: {
      create: ({ data }) => {
        const row = { id: `notification-${notifications.length + 1}`, read: false, createdAt: new Date(), ...data };
        notifications.push(row);
        return Promise.resolve(row);
      },
    },
  };
  const db = { $transaction: (callback) => callback(tx) };
  const io = { to: (room) => ({ emit: (name, payload) => emitted.push({ room, name, payload }) }) };
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
