import prisma from "../lib/prisma.js";
import { enqueueEvent } from "../services/eventPublisher.js";
import { getFollowingIds } from "../services/userService.js";
import cacheService from "../services/cacheService.js";

async function paginatePosts(where, limit = 10, cursor) {
  const posts = await prisma.post.findMany({
    where: { ...where, isHidden: false },
    take: limit + 1,
    ...(cursor && {
      cursor: { id: cursor },
      skip: 1,
    }),
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });

  const hasMore = posts.length > limit;
  const postsToReturn = hasMore ? posts.slice(0, -1) : posts;

  return {
    posts: postsToReturn.map(formatPost),
    hasMore,
    nextCursor: hasMore ? postsToReturn[postsToReturn.length - 1].id : null,
  };
}

function formatPost(post) {
  let mediaUrls = [];
  if (post.mediaUrls != null) {
    try {
      const parsed =
        typeof post.mediaUrls === "string"
          ? JSON.parse(post.mediaUrls)
          : post.mediaUrls;
      mediaUrls = Array.isArray(parsed)
        ? parsed.filter((u) => typeof u === "string" && u.length > 0)
        : [];
    } catch {
      mediaUrls = [];
    }
  }

  return {
    ...post,
    postType: post.postType.toUpperCase(),
    mediaUrls,
    createdAt: post.createdAt.toISOString(),
    updatedAt: post.updatedAt.toISOString(),
  };
}

const resolvers = {
  Post: {
    user: (post, _, context) => {
      if (!post?.userId) return null;
      return context.loaders.user.load(post.userId);
    },
  },

  Query: {
    getNewsFeed: async (_, { limit = 10, cursor }) => {
      try {
        const cached = await cacheService.getCachedNewsFeed(limit, cursor);
        if (cached) {
          return cached;
        }

        const posts = await prisma.post.findMany({
          where: { isHidden: false },
          take: limit + 1,
          ...(cursor && {
            cursor: { id: cursor },
            skip: 1,
          }),
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        });

        const hasMore = posts.length > limit;
        const postsToReturn = hasMore ? posts.slice(0, -1) : posts;

        const result = {
          posts: postsToReturn.map(formatPost),
          hasMore,
          nextCursor: hasMore
            ? postsToReturn[postsToReturn.length - 1].id
            : null,
        };

        await cacheService.cacheNewsFeed(limit, cursor, result);
        return result;
      } catch (error) {
        console.error("Error fetching news feed:", error);
        throw new Error("Failed to fetch news feed");
      }
    },

    getUserPosts: async (_, { userId, limit = 10, cursor }) => {
      try {
        return await paginatePosts({ userId }, limit, cursor);
      } catch (error) {
        console.error("Error fetching user posts:", error);
        throw new Error("Failed to fetch user posts");
      }
    },

    getFollowingFeed: async (_, { limit = 10, cursor }, context) => {
      if (!context.user) {
        throw new Error("Unauthorized. Please login first.");
      }

      try {
        const followingIds = await getFollowingIds(context.user.userId);
        const authorIds = [...new Set([context.user.userId, ...followingIds])];

        if (authorIds.length === 0) {
          return { posts: [], hasMore: false, nextCursor: null };
        }

        return await paginatePosts({ userId: { in: authorIds } }, limit, cursor);
      } catch (error) {
        console.error("Error fetching following feed:", error);
        throw new Error("Failed to fetch following feed");
      }
    },

    getPost: async (_, { id }) => {
      try {
        const cached = await cacheService.getCachedPost(id);
        if (cached) {
          return cached;
        }

        const post = await prisma.post.findUnique({
          where: { id },
        });

        if (!post) {
          throw new Error("Post not found");
        }

        const result = formatPost(post);
        await cacheService.cachePost(id, result);
        return result;
      } catch (error) {
        console.error("Error fetching post:", error);
        throw new Error("Failed to fetch post");
      }
    },
  },

  Mutation: {
    createPost: async (_, { input }, context) => {
      if (!context.user) {
        throw new Error("Unauthorized. Please login first.");
      }

      const { content, postType, mediaUrls, location } = input;

      if (!postType) {
        return {
          success: false,
          message: "Post type is required",
          post: null,
        };
      }

      if (
        (postType === "IMAGE" || postType === "VIDEO") &&
        (!mediaUrls || mediaUrls.length === 0)
      ) {
        return {
          success: false,
          message: `${postType} post must have media URLs`,
          post: null,
        };
      }

      try {
        const post = await prisma.$transaction(async (tx) => {
          const created = await tx.post.create({
            data: {
              userId: context.user.userId,
              content: content || null,
              postType: postType.toLowerCase(),
              mediaUrls: mediaUrls && mediaUrls.length > 0 ? mediaUrls : null,
              location: location || null,
            },
          });
          await enqueueEvent(tx, "post.created", {
            postId: created.id,
            userId: created.userId,
          });
          return created;
        });

        await cacheService.invalidateAllNewsFeeds();

        return {
          success: true,
          message: "Post created successfully",
          post: formatPost(post),
        };
      } catch (error) {
        console.error("Error creating post:", error);
        return {
          success: false,
          message: "Failed to create post",
          post: null,
        };
      }
    },

    deletePost: async (_, { id }, context) => {
      if (!context.user) {
        throw new Error("Unauthorized. Please login first.");
      }

      try {
        const post = await prisma.post.findUnique({
          where: { id },
        });

        if (!post) {
          return {
            success: false,
            message: "Post not found",
            post: null,
          };
        }

        if (post.userId !== context.user.userId) {
          return {
            success: false,
            message: "You can only delete your own posts",
            post: null,
          };
        }

        await prisma.$transaction(async (tx) => {
          await tx.post.delete({ where: { id } });
          await enqueueEvent(tx, "post.deleted", {
            postId: id,
            userId: post.userId,
          });
        });

        await cacheService.invalidatePost(id);

        return {
          success: true,
          message: "Post deleted successfully",
          post: null,
        };
      } catch (error) {
        console.error("Error deleting post:", error);
        return {
          success: false,
          message: "Failed to delete post",
          post: null,
        };
      }
    },
  },
};

export default resolvers;
