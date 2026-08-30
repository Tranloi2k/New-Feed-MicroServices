import prisma from "../lib/prisma.js";
import { enqueueEvent } from "../services/eventPublisher.js";
import cacheService from "../services/cacheService.js";
import pubsub, { COMMENT_EVENTS } from "../config/pubsub.js";
import { withFilter } from "graphql-subscriptions";
import { getPostIdentity } from "../services/postService.js";
import {
  attachReplies,
  collectDescendantIds,
  normalizePagination,
  resolveParentComment,
  validateContent,
} from "../services/commentService.js";

function formatComment(comment) {
  return {
    ...comment,
    createdAt: comment.createdAt.toISOString(),
    updatedAt: comment.updatedAt.toISOString(),
  };
}

const resolvers = {
  Comment: {
    user: (comment, _, context) => {
      if (!comment?.userId) return null;
      return context.loaders.user.load(comment.userId);
    },
    replies: (comment) => comment.replies ?? [],
  },

  Query: {
    getComments: async (_, { postId, limit: requestedLimit, cursor: requestedCursor }) => {
      const { limit, cursor } = normalizePagination({
        limit: requestedLimit,
        cursor: requestedCursor,
      });
      try {
        const cached = await cacheService.getCachedCommentsList(
          postId,
          limit,
          cursor
        );
        if (cached) {
          return cached;
        }

        const comments = await prisma.comment.findMany({
          where: {
            postId,
            parentCommentId: null,
          },
          take: limit + 1,
          ...(cursor && {
            cursor: { id: cursor },
            skip: 1,
          }),
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        });

        const hasMore = comments.length > limit;
        const commentsToReturn = hasMore ? comments.slice(0, -1) : comments;

        const commentsWithReplies = await attachReplies(
          commentsToReturn,
          formatComment
        );

        const result = {
          comments: commentsWithReplies,
          hasMore,
          nextCursor: hasMore
            ? commentsToReturn[commentsToReturn.length - 1].id
            : null,
        };

        await cacheService.cacheCommentsList(postId, limit, cursor, result);
        return result;
      } catch (error) {
        console.error("Error fetching comments:", error);
        throw new Error("Failed to fetch comments");
      }
    },
  },

  Mutation: {
    createComment: async (_, { input }, context) => {
      if (!context.user) {
        throw new Error("Unauthorized. Please login first.");
      }

      const { postId, content, parentCommentId } = input;

      const validated = validateContent(content);
      if (validated.error) {
        return { success: false, message: validated.error, comment: null };
      }

      try {
        const parent = await resolveParentComment(parentCommentId, postId);
        if (parent.error) {
          return { success: false, message: parent.error, comment: null };
        }

        const post = await getPostIdentity(postId);
        // The identity headers carry only an id and an email, and the email must
        // never reach another user's notification.
        const author = await context.loaders.user.load(context.user.userId);
        const comment = await prisma.$transaction(async (tx) => {
          const created = await tx.comment.create({
            data: {
              postId,
              userId: context.user.userId,
              content: validated.content,
              parentCommentId: parent.parentCommentId,
            },
          });
          await enqueueEvent(tx, "comment.created", {
            comment: {
              ...created,
              authorId: created.userId,
              authorName: author?.username || "Người dùng",
              createdAt: created.createdAt.toISOString(),
              updatedAt: created.updatedAt.toISOString(),
            },
            postId,
            postAuthorId: post.userId,
          });
          return created;
        });

        await cacheService.invalidatePostComments(postId);

        if (parent.parentCommentId) {
          await cacheService.invalidateSingleComment(parent.parentCommentId);
        }

        const commentPayload = {
          ...formatComment(comment),
          replies: [],
        };

        await pubsub.publish(COMMENT_EVENTS.COMMENT_ADDED, {
          commentAdded: commentPayload,
          postId,
        });

        return {
          success: true,
          message: "Comment created successfully",
          comment: commentPayload,
        };
      } catch (error) {
        console.error("Error creating comment:", error);
        return {
          success: false,
          message: "Failed to create comment",
          comment: null,
        };
      }
    },

    deleteComment: async (_, { id }, context) => {
      if (!context.user) {
        throw new Error("Unauthorized. Please login first.");
      }

      try {
        const comment = await prisma.comment.findUnique({
          where: { id },
        });

        if (!comment) {
          return {
            success: false,
            message: "Comment not found",
            comment: null,
          };
        }

        if (comment.userId !== context.user.userId) {
          return {
            success: false,
            message: "You can only delete your own comments",
            comment: null,
          };
        }

        const descendantIds = await collectDescendantIds(id);

        await prisma.$transaction(async (tx) => {
          if (descendantIds.length) {
            await tx.comment.deleteMany({ where: { id: { in: descendantIds } } });
          }
          await tx.comment.delete({ where: { id } });
          await enqueueEvent(tx, "comment.deleted", {
            commentId: id,
            postId: comment.postId,
          });
        });

        await cacheService.invalidatePostComments(comment.postId);
        await cacheService.invalidateSingleComment(id);
        if (descendantIds.length > 0) {
          await cacheService.invalidateReplies(descendantIds);
        }

        await pubsub.publish(COMMENT_EVENTS.COMMENT_DELETED, {
          commentDeleted: id,
          postId: comment.postId,
        });

        return {
          success: true,
          message: "Comment deleted successfully",
          comment: null,
        };
      } catch (error) {
        console.error("Error deleting comment:", error);
        return {
          success: false,
          message: "Failed to delete comment",
          comment: null,
        };
      }
    },
  },

  Subscription: {
    commentAdded: {
      subscribe: withFilter(
        () => pubsub.asyncIterator([COMMENT_EVENTS.COMMENT_ADDED]),
        (payload, variables) => payload.postId === variables.postId
      ),
    },

    commentUpdated: {
      subscribe: withFilter(
        () => pubsub.asyncIterator([COMMENT_EVENTS.COMMENT_UPDATED]),
        (payload, variables) => payload.postId === variables.postId
      ),
    },

    commentDeleted: {
      subscribe: withFilter(
        () => pubsub.asyncIterator([COMMENT_EVENTS.COMMENT_DELETED]),
        (payload, variables) => payload.postId === variables.postId
      ),
    },
  },
};

export default resolvers;
