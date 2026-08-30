import assert from "node:assert/strict";
import test from "node:test";
import {
  attachReplies,
  collectDescendantIds,
  normalizePagination,
  resolveParentComment,
  validateContent,
  MAX_CONTENT_LENGTH,
  MAX_PAGE_SIZE,
} from "../src/services/commentService.js";
import { createUserLoader } from "../src/graphql/loaders/userLoader.js";

const identity = (comment) => comment;

test("paging is clamped so an unauthenticated caller cannot ask for the table", () => {
  assert.equal(normalizePagination({ limit: 1_000_000 }).limit, MAX_PAGE_SIZE);
  assert.equal(normalizePagination({ limit: 0 }).limit, 1);
  assert.equal(normalizePagination({ limit: -5 }).limit, 1);
  assert.equal(normalizePagination({}).limit, 20);
  assert.equal(normalizePagination({ limit: 30 }).limit, 30);
});

test("only a positive integer cursor survives", () => {
  assert.equal(normalizePagination({ cursor: 42 }).cursor, 42);
  assert.equal(normalizePagination({ cursor: -1 }).cursor, null);
  assert.equal(normalizePagination({ cursor: 1.5 }).cursor, null);
  assert.equal(normalizePagination({}).cursor, null);
});

test("content must be present and bounded", () => {
  assert.equal(validateContent("  hello  ").content, "hello");
  assert.equal(validateContent("   ").error, "Comment content is required");
  assert.equal(validateContent(undefined).error, "Comment content is required");
  assert.match(
    validateContent("x".repeat(MAX_CONTENT_LENGTH + 1)).error,
    /must not exceed/
  );
  assert.equal(validateContent("x".repeat(MAX_CONTENT_LENGTH)).error, undefined);
});

test("replies for a whole page are fetched in one query", async () => {
  let queries = 0;
  const db = {
    comment: {
      findMany: async ({ where }) => {
        queries += 1;
        assert.deepEqual(where.parentCommentId.in, [1, 2]);
        return [
          { id: 10, parentCommentId: 1 },
          { id: 11, parentCommentId: 1 },
          { id: 12, parentCommentId: 2 },
        ];
      },
    },
  };

  const result = await attachReplies([{ id: 1 }, { id: 2 }], identity, db);

  assert.equal(queries, 1, "one query regardless of page size");
  assert.deepEqual(result[0].replies.map(({ id }) => id), [10, 11]);
  assert.deepEqual(result[1].replies.map(({ id }) => id), [12]);
});

test("a comment without replies gets an empty list, and an empty page skips the query", async () => {
  const db = {
    comment: { findMany: async () => [] },
  };
  const result = await attachReplies([{ id: 5 }], identity, db);
  assert.deepEqual(result[0].replies, []);

  const noQuery = {
    comment: { findMany: async () => assert.fail("must not query") },
  };
  assert.deepEqual(await attachReplies([], identity, noQuery), []);
});

test("a reply must point at a real comment on the same post", async () => {
  const db = {
    comment: {
      findUnique: async ({ where }) =>
        where.id === 7 ? { id: 7, postId: 100 } : null,
    },
  };

  assert.deepEqual(await resolveParentComment(7, 100, db), { parentCommentId: 7 });
  assert.equal((await resolveParentComment(7, 999, db)).error, "Parent comment belongs to a different post");
  assert.equal((await resolveParentComment(404, 100, db)).error, "Parent comment not found");
  assert.match((await resolveParentComment(-3, 100, db)).error, /positive integer/);
  assert.deepEqual(await resolveParentComment(null, 100, db), { parentCommentId: null });
  assert.deepEqual(await resolveParentComment(undefined, 100, db), { parentCommentId: null });
});

test("deleting collects grandchildren, not just direct replies", async () => {
  // 1 → 2, 3 → 4 → 5
  const children = { 1: [2, 3], 3: [4], 4: [5] };
  const db = {
    comment: {
      findMany: async ({ where }) =>
        where.parentCommentId.in
          .flatMap((id) => children[id] || [])
          .map((id) => ({ id })),
    },
  };

  const descendants = await collectDescendantIds(1, db);
  assert.deepEqual(descendants.sort((a, b) => a - b), [2, 3, 4, 5]);
});

test("a comment with no replies collects nothing", async () => {
  const db = { comment: { findMany: async () => [] } };
  assert.deepEqual(await collectDescendantIds(9, db), []);
});

test("the user loader asks for every author at once and keeps the order", async () => {
  const batches = [];
  const loader = createUserLoader(async (ids) => {
    batches.push(ids);
    // Answer out of order on purpose: DataLoader relies on the mapping back.
    return ids.map((id) => ({ id, username: `user${id}` })).reverse().reverse();
  });

  const [a, b, c] = await Promise.all([
    loader.load(3),
    loader.load(1),
    loader.load(3),
  ]);

  assert.equal(batches.length, 1, "one call for the whole page");
  assert.deepEqual(batches[0], [3, 1], "duplicate ids are deduplicated");
  assert.equal(a.username, "user3");
  assert.equal(b.username, "user1");
  assert.equal(c.username, "user3");
});
