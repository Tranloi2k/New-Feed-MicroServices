import prisma from "../lib/prisma.js";

export const MAX_PAGE_SIZE = 50;
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_CONTENT_LENGTH = 5000;
// A reply chain deeper than this is a data problem, not a conversation.
const MAX_SUBTREE_DEPTH = 50;

/**
 * Clamps paging input. Without this a caller can ask for a million rows, which
 * Postgres will happily try to serve on an endpoint that needs no login.
 */
export function normalizePagination({ limit, cursor } = {}) {
  const requested = Number.isInteger(limit) ? limit : DEFAULT_PAGE_SIZE;
  const safeLimit = Math.min(Math.max(requested, 1), MAX_PAGE_SIZE);
  const safeCursor =
    Number.isSafeInteger(cursor) && cursor > 0 ? cursor : null;
  return { limit: safeLimit, cursor: safeCursor };
}

export function validateContent(content) {
  const trimmed = typeof content === "string" ? content.trim() : "";
  if (!trimmed) return { error: "Comment content is required" };
  if (trimmed.length > MAX_CONTENT_LENGTH) {
    return { error: `Comment must not exceed ${MAX_CONTENT_LENGTH} characters` };
  }
  return { content: trimmed };
}

/**
 * A reply must hang off a real comment on the same post; otherwise a client can
 * graft replies onto another post's thread or onto nothing at all.
 */
export async function resolveParentComment(parentCommentId, postId, db = prisma) {
  if (parentCommentId === undefined || parentCommentId === null) {
    return { parentCommentId: null };
  }
  if (!Number.isSafeInteger(parentCommentId) || parentCommentId <= 0) {
    return { error: "parentCommentId must be a positive integer" };
  }

  const parent = await db.comment.findUnique({
    where: { id: parentCommentId },
    select: { id: true, postId: true },
  });
  if (!parent) return { error: "Parent comment not found" };
  if (parent.postId !== postId) {
    return { error: "Parent comment belongs to a different post" };
  }
  return { parentCommentId: parent.id };
}

/**
 * Loads every reply for a page of comments in one query. Fetching them per
 * comment turned a page of 20 into 21 round trips.
 */
export async function attachReplies(comments, format, db = prisma) {
  if (!comments.length) return [];
  const replies = await db.comment.findMany({
    where: { parentCommentId: { in: comments.map(({ id }) => id) } },
    orderBy: { createdAt: "asc" },
  });

  const byParent = new Map();
  for (const reply of replies) {
    const bucket = byParent.get(reply.parentCommentId) || [];
    bucket.push(format(reply));
    byParent.set(reply.parentCommentId, bucket);
  }

  return comments.map((comment) => ({
    ...format(comment),
    replies: byParent.get(comment.id) || [],
  }));
}

/**
 * Every descendant of a comment, deepest level included. Deleting only direct
 * children left grandchildren pointing at a parent that no longer exists, so
 * they became invisible rows nobody could reach or remove.
 */
export async function collectDescendantIds(commentId, db = prisma) {
  const collected = [];
  let frontier = [commentId];

  for (let depth = 0; depth < MAX_SUBTREE_DEPTH && frontier.length; depth += 1) {
    const children = await db.comment.findMany({
      where: { parentCommentId: { in: frontier } },
      select: { id: true },
    });
    frontier = children.map(({ id }) => id);
    collected.push(...frontier);
  }

  return collected;
}
