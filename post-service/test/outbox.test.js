import assert from "node:assert/strict";
import test from "node:test";
import { enqueueEvent } from "../src/services/eventPublisher.js";
import { requireServiceAuth } from "../src/middleware/serviceAuth.js";

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

test("internal post API rejects an empty service secret", () => {
  const previous = process.env.SERVICE_SECRET;
  process.env.SERVICE_SECRET = "";
  let status;
  const req = { headers: { "x-service-token": "" } };
  const res = {
    status(value) { status = value; return this; },
    json() {},
  };
  let called = false;
  requireServiceAuth(req, res, () => { called = true; });
  if (previous === undefined) delete process.env.SERVICE_SECRET;
  else process.env.SERVICE_SECRET = previous;

  assert.equal(status, 403);
  assert.equal(called, false);
});
