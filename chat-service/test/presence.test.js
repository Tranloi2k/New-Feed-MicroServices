import assert from "node:assert/strict";
import test from "node:test";
import { getOnlineUserIds } from "../src/services/presenceService.js";
import { getPeerIds } from "../src/services/conversationService.js";

test("online lookup keeps only the users holding a live presence key", async () => {
  const asked = [];
  const client = {
    mGet: async (keys) => {
      asked.push(...keys);
      return keys.map((key) => (key === "presence:user:7" ? "1" : null));
    },
  };
  assert.deepEqual(await getOnlineUserIds([7, 9, 7], client), [7]);
  assert.deepEqual(asked, ["presence:user:7", "presence:user:9"]);
});

test("online lookup skips Redis entirely for an empty or invalid peer list", async () => {
  const client = { mGet: async () => assert.fail("Redis must not be queried") };
  assert.deepEqual(await getOnlineUserIds([], client), []);
  assert.deepEqual(await getOnlineUserIds([0, -3, 1.5, NaN], client), []);
});

test("peer lookup asks for distinct active members other than the caller", async () => {
  let query = null;
  const db = {
    conversationMember: {
      findMany: async (args) => {
        query = args;
        return [{ userId: 5 }, { userId: 8 }];
      },
    },
  };
  assert.deepEqual(await getPeerIds(3, ["c1", "c2"], db), [5, 8]);
  assert.deepEqual(query.where, {
    conversationId: { in: ["c1", "c2"] },
    leftAt: null,
    userId: { not: 3 },
  });
  assert.deepEqual(query.distinct, ["userId"]);
});

test("peer lookup does not hit the database without conversations", async () => {
  const db = { conversationMember: { findMany: async () => assert.fail("no query expected") } };
  assert.deepEqual(await getPeerIds(3, [], db), []);
});
