import assert from "node:assert/strict";
import test from "node:test";
import { togglePostLike } from "../src/services/postLikeService.js";

function createTransaction({ liked = false, likeCount = 0 } = {}) {
  let currentLike = liked ? { postId: 12, userId: 7 } : null;
  let currentCount = likeCount;

  return {
    post: {
      findFirst: async () => ({ id: 12, userId: 3, likeCount: currentCount }),
      findUnique: async () => ({ id: 12, userId: 3, likeCount: currentCount }),
      update: async () => ({ id: 12, userId: 3, likeCount: ++currentCount }),
      updateMany: async () => {
        if (currentCount > 0) currentCount -= 1;
        return { count: 1 };
      },
    },
    postLike: {
      findUnique: async () => currentLike,
      create: async ({ data }) => (currentLike = data),
      delete: async () => (currentLike = null),
    },
  };
}

test("likes a post and emits the notification event", async () => {
  const tx = createTransaction({ likeCount: 2 });
  let event;

  const result = await togglePostLike(
    tx,
    { postId: 12, userId: 7, likedByName: "Lan" },
    async (_tx, eventType, payload) => {
      event = { eventType, payload };
    }
  );

  assert.equal(result.liked, true);
  assert.equal(result.post.likeCount, 3);
  assert.deepEqual(event, {
    eventType: "post.liked",
    payload: {
      postId: 12,
      postAuthorId: 3,
      likedBy: 7,
      likedByName: "Lan",
    },
  });
});

test("unlikes a post without allowing a negative counter", async () => {
  const tx = createTransaction({ liked: true, likeCount: 0 });
  let emitted = false;

  const result = await togglePostLike(
    tx,
    { postId: 12, userId: 7, likedByName: "Lan" },
    async () => {
      emitted = true;
    }
  );

  assert.equal(result.liked, false);
  assert.equal(result.post.likeCount, 0);
  assert.equal(emitted, false);
});
