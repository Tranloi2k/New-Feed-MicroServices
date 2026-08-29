import assert from "node:assert/strict";
import test from "node:test";

import prisma from "../src/lib/prisma.js";
import { getFollowerIds, getFollowingIds } from "../src/services/followService.js";

test("internal following IDs use a keyset cursor instead of an offset", async () => {
  const original = prisma.follow.findMany;
  let query;
  prisma.follow.findMany = async (value) => {
    query = value;
    return [{ followingId: 12 }, { followingId: 18 }, { followingId: 22 }];
  };

  try {
    const result = await getFollowingIds(7, { limit: 2, cursor: 10 });
    assert.deepEqual(query.where, { followerId: 7, followingId: { gt: 10 } });
    assert.equal(query.skip, undefined);
    assert.deepEqual(result, { ids: [12, 18], nextCursor: "18" });
  } finally {
    prisma.follow.findMany = original;
  }
});

test("internal follower IDs return the final identifier as the next cursor", async () => {
  const original = prisma.follow.findMany;
  prisma.follow.findMany = async () => [{ followerId: 3 }, { followerId: 5 }];

  try {
    const result = await getFollowerIds(7, { limit: 2, cursor: 0 });
    assert.deepEqual(result, { ids: [3, 5], nextCursor: null });
  } finally {
    prisma.follow.findMany = original;
  }
});
