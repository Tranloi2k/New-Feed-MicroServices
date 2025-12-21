import express from "express";
import prisma from "../lib/prisma.js";
import { getUserById } from "../services/userService.js";

const router = express.Router();

// Get comments for a post (REST endpoint)
router.get("/:postId", async (req, res) => {
  try {
    const { postId } = req.params;
    const limit = parseInt(req.query.limit) || 20;
    const cursor = req.query.cursor ? parseInt(req.query.cursor) : null;

    const comments = await prisma.comment.findMany({
      where: {
        postId: parseInt(postId),
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

    const commentsWithData = await Promise.all(
      commentsToReturn.map(async (comment) => {
        const user = await getUserById(comment.userId);

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

    res.json({
      success: true,
      data: {
        comments: commentsWithData,
        hasMore,
        nextCursor: hasMore
          ? commentsToReturn[commentsToReturn.length - 1].id
          : null,
      },
    });
  } catch (error) {
    console.error("Error fetching comments:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch comments",
    });
  }
});

export default router;
