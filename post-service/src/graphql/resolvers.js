import prisma from "../lib/prisma.js";
import { getUserById } from "../services/userService.js";
import { publishEvent } from "../services/eventPublisher.js";
import cacheService from "../services/cacheService.js";

const resolvers = {
  Query: {
    getNewsFeed: async (_, { limit = 10, cursor }, context) => {
      try {
        // Try cache first
        const cached = await cacheService.getCachedNewsFeed(limit, cursor);
        if (cached) {
          console.log(`✅ Cache HIT for newsfeed:${limit}:${cursor || 'first'}`);
          return cached;
        }

        console.log(`⚠️ Cache MISS for newsfeed:${limit}:${cursor || 'first'}`);

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

        // Fetch user data for each post
        const postsWithUsers = await Promise.all(
          postsToReturn.map(async (post) => {
            const user = await getUserById(post.userId);
            return {
              ...post,
              postType: post.postType.toUpperCase(),
              mediaUrls: post.mediaUrls
                ? JSON.parse(JSON.stringify(post.mediaUrls))
                : [],
              createdAt: post.createdAt.toISOString(),
              updatedAt: post.updatedAt.toISOString(),
              user,
            };
          })
        );

        const result = {
          posts: postsWithUsers,
          hasMore,
          nextCursor: hasMore
            ? postsToReturn[postsToReturn.length - 1].id
            : null,
        };

        // Cache the result (2 minutes TTL)
        await cacheService.cacheNewsFeed(limit, cursor, result);

        return result;
      } catch (error) {
        console.error("Error fetching news feed:", error);
        throw new Error("Failed to fetch news feed");
      }
    },

    getPost: async (_, { id }) => {
      try {
        // Try cache first
        const cached = await cacheService.getCachedPost(id);
        if (cached) {
          console.log(`✅ Cache HIT for post:${id}`);
          return cached;
        }

        console.log(`⚠️ Cache MISS for post:${id}`);

        const post = await prisma.post.findUnique({
          where: { id },
        });

        if (!post) {
          throw new Error("Post not found");
        }

        const user = await getUserById(post.userId);

        const result = {
          ...post,
          postType: post.postType.toUpperCase(),
          mediaUrls: post.mediaUrls
            ? JSON.parse(JSON.stringify(post.mediaUrls))
            : [],
          createdAt: post.createdAt.toISOString(),
          updatedAt: post.updatedAt.toISOString(),
          user,
        };

        // Cache the result (15 minutes TTL)
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

      // Validate
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
        const post = await prisma.post.create({
          data: {
            userId: context.user.userId,
            content: content || null,
            postType: postType.toLowerCase(),
            mediaUrls: mediaUrls && mediaUrls.length > 0 ? mediaUrls : null,
            location: location || null,
          },
        });

        // Publish event
        await publishEvent("post.created", {
          postId: post.id,
          userId: post.userId,
          timestamp: new Date().toISOString(),
        });

        // Invalidate news feed caches (new post affects all feeds)
        await cacheService.invalidateAllNewsFeeds();

        const user = await getUserById(post.userId);

        return {
          success: true,
          message: "Post created successfully",
          post: {
            ...post,
            postType: post.postType.toUpperCase(),
            mediaUrls: post.mediaUrls
              ? JSON.parse(JSON.stringify(post.mediaUrls))
              : [],
            createdAt: post.createdAt.toISOString(),
            updatedAt: post.updatedAt.toISOString(),
            user,
          },
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

        await prisma.post.delete({
          where: { id },
        });

        // Invalidate caches
        await cacheService.invalidatePost(id);

        // Publish event
        await publishEvent("post.deleted", {
          postId: id,
          userId: post.userId,
          timestamp: new Date().toISOString(),
        });

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
