import prisma from "../lib/prisma.js";
import { getUserById } from "../services/userService.js";
import { publishEvent } from "../services/eventPublisher.js";
import cacheService from "../services/cacheService.js";
import pubsub, { COMMENT_EVENTS } from "../config/pubsub.js";
import { withFilter } from "graphql-subscriptions";

const resolvers = {
  Query: {
    getComments: async (_, { postId, limit = 20, cursor }) => {
      try {
        // Try cache first
        const cached = await cacheService.getCachedCommentsList(postId, limit, cursor);
        if (cached) {
          return cached;
        }

        // Cache miss - query database
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

        // Fetch user data and replies for each comment
        const commentsWithData = await Promise.all(
          commentsToReturn.map(async (comment) => {
            const user = await getUserById(comment.userId);

            // Fetch replies
            const replies = await prisma.comment.findMany({
              where: { parentCommentId: comment.id },
              orderBy: { createdAt: "asc" },
            });

            const repliesWithUsers = await Promise.all(
              replies.map(async (reply) => {
                const replyUser = await getUserById(reply.userId);
                return {
                  ...reply,
                  user: replyUser,
                  createdAt: reply.createdAt.toISOString(),
                  updatedAt: reply.updatedAt.toISOString(),
                  replies: [],
                };
              })
            );

            return {
              ...comment,
              user,
              createdAt: comment.createdAt.toISOString(),
              updatedAt: comment.updatedAt.toISOString(),
              replies: repliesWithUsers,
            };
          })
        );

        const result = {
          comments: commentsWithData,
          hasMore,
          nextCursor: hasMore
            ? commentsToReturn[commentsToReturn.length - 1].id
            : null,
        };

        // Cache the result for future requests
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

      if (!content || content.trim().length === 0) {
        return {
          success: false,
          message: "Comment content is required",
          comment: null,
        };
      }

      try {
        const comment = await prisma.comment.create({
          data: {
            postId,
            userId: context.user.userId,
            content: content.trim(),
            parentCommentId: parentCommentId || null,
          },
        });

        const user = await getUserById(comment.userId);

        // Invalidate comments cache for this post
        await cacheService.invalidatePostComments(postId);

        // If this is a reply, also invalidate the parent comment cache
        if (parentCommentId) {
          await cacheService.invalidateSingleComment(parentCommentId);
        }

        const commentWithUser = {
          ...comment,
          user,
          createdAt: comment.createdAt.toISOString(),
          updatedAt: comment.updatedAt.toISOString(),
          replies: [],
        };

        // Publish to RabbitMQ for notification service
        await publishEvent("comment.created", {
          comment: {
            ...comment,
            authorId: comment.userId,
            authorName: user?.username || user?.name || "Unknown",
            createdAt: comment.createdAt.toISOString(),
            updatedAt: comment.updatedAt.toISOString(),
          },
          postId,
          postAuthorId: null, // TODO: Fetch from post service
        });

        // 🔥 Publish to GraphQL Subscription
        await pubsub.publish(COMMENT_EVENTS.COMMENT_ADDED, {
          commentAdded: commentWithUser,
          postId,
        });

        return {
          success: true,
          message: "Comment created successfully",
          comment: commentWithUser,
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

        // Delete replies first
        const repliesToDelete = await prisma.comment.findMany({
          where: { parentCommentId: id },
          select: { id: true },
        });

        await prisma.comment.deleteMany({
          where: { parentCommentId: id },
        });

        // Delete the comment
        await prisma.comment.delete({
          where: { id },
        });

        // Invalidate caches
        await cacheService.invalidatePostComments(comment.postId);
        await cacheService.invalidateSingleComment(id);
        if (repliesToDelete.length > 0) {
          await cacheService.invalidateReplies(repliesToDelete.map(r => r.id));
        }

        // Publish to RabbitMQ for notification service
        await publishEvent("comment.deleted", {
          commentId: id,
          postId: comment.postId,
        });

        // 🔥 Publish to GraphQL Subscription
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
      // Filter: Only send to clients subscribed to this specific postId
      subscribe: withFilter(
        () => pubsub.asyncIterator([COMMENT_EVENTS.COMMENT_ADDED]),
        (payload, variables) => {
          // Only send to clients watching this post
          return payload.postId === variables.postId;
        }
      ),
    },

    commentUpdated: {
      subscribe: withFilter(
        () => pubsub.asyncIterator([COMMENT_EVENTS.COMMENT_UPDATED]),
        (payload, variables) => {
          return payload.postId === variables.postId;
        }
      ),
    },

    commentDeleted: {
      subscribe: withFilter(
        () => pubsub.asyncIterator([COMMENT_EVENTS.COMMENT_DELETED]),
        (payload, variables) => {
          return payload.postId === variables.postId;
        }
      ),
    },
  },
};

export default resolvers;
