import assert from "node:assert/strict";
import test from "node:test";
import { participantsHash } from "../src/services/conversationService.js";
import { createMessage, validateMessageInput } from "../src/services/messageService.js";

const uuid = "123e4567-e89b-12d3-a456-426614174000";

test("direct participant hash is stable regardless of member order", () => {
  assert.equal(participantsHash([12, 5]), participantsHash([5, 12]));
  assert.notEqual(participantsHash([5, 12]), participantsHash([5, 13]));
});

test("message input requires a UUID client id", () => {
  assert.throws(() => validateMessageInput({ conversationId: "c", clientMessageId: "bad", content: "hello" }), /UUID/);
  assert.equal(validateMessageInput({ conversationId: "c", clientMessageId: uuid, content: " hello " }).content, "hello");
});

test("a duplicate clientMessageId returns the existing message without recreating it", async () => {
  const existing = { id: "01TEST", conversationId: "conversation", clientMessageId: uuid, content: "hello" };
  const db = {
    conversationMember: { findUnique: async () => ({ conversationId: "conversation", userId: 1, leftAt: null }) },
    $transaction: async () => { throw Object.assign(new Error("unique"), { code: "P2002" }); },
    message: { findUnique: async () => existing },
  };
  const result = await createMessage(1, { conversationId: "conversation", clientMessageId: uuid, content: "hello" }, db);
  assert.deepEqual(result, { message: existing, created: false });
});
