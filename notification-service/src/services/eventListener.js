import amqp from "amqplib";
import { createNotification } from "./notificationStore.js";

let channel = null;

async function persistAndEmit(io, userId, payload) {
  if (!userId) return null;

  const saved = await createNotification({
    userId,
    type: payload.type,
    message: payload.message,
    data: payload.data ?? null,
  });

  io.to(`user:${userId}`).emit("notification", saved);
  return saved;
}

export async function initEventListener(io) {
  try {
    const connection = await amqp.connect(process.env.RABBITMQ_URL);
    channel = await connection.createChannel();

    await channel.assertExchange("comments", "topic", { durable: true });
    await channel.assertExchange("posts", "topic", { durable: true });
    await channel.assertExchange("likes", "topic", { durable: true });

    const q = await channel.assertQueue("", { exclusive: true });

    channel.bindQueue(q.queue, "comments", "comment.created");
    channel.bindQueue(q.queue, "comments", "comment.updated");
    channel.bindQueue(q.queue, "comments", "comment.deleted");
    channel.bindQueue(q.queue, "posts", "post.created");
    channel.bindQueue(q.queue, "posts", "post.liked");
    channel.bindQueue(q.queue, "likes", "like.created");

    channel.consume(q.queue, async (msg) => {
      if (!msg) return;

      try {
        const event = JSON.parse(msg.content.toString());
        await handleEvent(io, event);
        channel.ack(msg);
      } catch (error) {
        console.error("Error processing event:", error);
        channel.nack(msg, false, false);
      }
    });

    console.log("RabbitMQ event listener initialized for notifications");
  } catch (error) {
    console.error("RabbitMQ listener failed:", error.message);
    setTimeout(() => initEventListener(io), 5000);
  }
}

async function handleEvent(io, event) {
  const { eventType, data } = event;

  switch (eventType) {
    case "comment.created":
      await handleCommentCreated(io, data);
      break;
    case "comment.updated":
      handleCommentUpdated(io, data);
      break;
    case "comment.deleted":
      handleCommentDeleted(io, data);
      break;
    case "post.created":
      await handlePostCreated(io, data);
      break;
    case "post.liked":
      await handlePostLiked(io, data);
      break;
    case "like.created":
      await handleLikeCreated(io, data);
      break;
    default:
      console.log(`Unknown event type: ${eventType}`);
  }
}

async function handleCommentCreated(io, data) {
  const { comment, postId, postAuthorId } = data;

  if (postAuthorId && comment.authorId !== postAuthorId) {
    await persistAndEmit(io, postAuthorId, {
      type: "new_comment",
      message: `${comment.authorName} commented on your post`,
      data: { postId, commentId: comment.id },
    });
  }

  io.to(`post:${postId}`).emit("new_comment", { postId, comment });
}

function handleCommentUpdated(io, data) {
  const { comment, postId } = data;
  io.to(`post:${postId}`).emit("comment_updated", { postId, comment });
}

function handleCommentDeleted(io, data) {
  const { commentId, postId } = data;
  io.to(`post:${postId}`).emit("comment_deleted", { postId, commentId });
}

async function handlePostCreated(io, data) {
  const { userId, postId } = data;
  const followers = data.followers || [];

  for (const followerId of followers) {
    await persistAndEmit(io, followerId, {
      type: "new_post",
      message: "Someone you follow created a new post",
      data: { postId, authorId: userId },
    });
  }
}

async function handlePostLiked(io, data) {
  const { postAuthorId, likedBy, likedByName, postId } = data;

  if (postAuthorId && likedBy !== postAuthorId) {
    await persistAndEmit(io, postAuthorId, {
      type: "post_liked",
      message: `${likedByName || "Someone"} liked your post`,
      data: { postId, likedBy },
    });
  }
}

async function handleLikeCreated(io, data) {
  const { commentAuthorId, likedBy, likedByName, commentId } = data;

  if (commentAuthorId && likedBy !== commentAuthorId) {
    await persistAndEmit(io, commentAuthorId, {
      type: "comment_liked",
      message: `${likedByName || "Someone"} liked your comment`,
      data: { commentId, likedBy },
    });
  }
}
