import amqp from "amqplib";

let channel = null;

export async function initEventListener(io) {
  try {
    const connection = await amqp.connect(
      process.env.RABBITMQ_URL
    );
    channel = await connection.createChannel();

    // Create exchanges for different event types
    await channel.assertExchange("comments", "topic", { durable: true });
    await channel.assertExchange("posts", "topic", { durable: true });
    await channel.assertExchange("likes", "topic", { durable: true });

    const q = await channel.assertQueue("", { exclusive: true });

    // Subscribe to comment events
    channel.bindQueue(q.queue, "comments", "comment.created");
    channel.bindQueue(q.queue, "comments", "comment.updated");
    channel.bindQueue(q.queue, "comments", "comment.deleted");

    // Subscribe to post events
    channel.bindQueue(q.queue, "posts", "post.created");
    channel.bindQueue(q.queue, "posts", "post.liked");

    // Subscribe to like events
    channel.bindQueue(q.queue, "likes", "like.created");

    channel.consume(q.queue, async (msg) => {
      if (msg) {
        try {
          const event = JSON.parse(msg.content.toString());
          console.log(`📥 Received event: ${event.eventType}`, event.data);

          await handleEvent(io, event);

          channel.ack(msg);
        } catch (error) {
          console.error("Error processing event:", error);
          channel.nack(msg, false, false);
        }
      }
    });

    console.log("✅ RabbitMQ event listener initialized for notifications");
  } catch (error) {
    console.error("❌ RabbitMQ listener failed:", error.message);
    // Retry connection after 5 seconds
    setTimeout(() => initEventListener(io), 5000);
  }
}

async function handleEvent(io, event) {
  const { eventType, data } = event;

  switch (eventType) {
    case "comment.created":
      handleCommentCreated(io, data);
      break;
    case "comment.updated":
      handleCommentUpdated(io, data);
      break;
    case "comment.deleted":
      handleCommentDeleted(io, data);
      break;
    case "post.created":
      handlePostCreated(io, data);
      break;
    case "post.liked":
      handlePostLiked(io, data);
      break;
    case "like.created":
      handleLikeCreated(io, data);
      break;
    default:
      console.log(`Unknown event type: ${eventType}`);
  }
}

function handleCommentCreated(io, data) {
  const { comment, postId, postAuthorId } = data;

  // Notify post author about new comment
  if (postAuthorId && comment.authorId !== postAuthorId) {
    io.to(`user:${postAuthorId}`).emit("notification", {
      type: "new_comment",
      message: `${comment.authorName} commented on your post`,
      data: comment,
      createdAt: new Date(),
    });
  }

  // Send comment to all users watching this post
  io.to(`post:${postId}`).emit("new_comment", {
    postId,
    comment,
  });

  console.log(`✅ Sent new comment notification for post ${postId}`);
}

function handleCommentUpdated(io, data) {
  const { comment, postId } = data;

  // Send update to all users watching this post
  io.to(`post:${postId}`).emit("comment_updated", {
    postId,
    comment,
  });

  console.log(`✅ Sent comment update for post ${postId}`);
}

function handleCommentDeleted(io, data) {
  const { commentId, postId } = data;

  // Send deletion to all users watching this post
  io.to(`post:${postId}`).emit("comment_deleted", {
    postId,
    commentId,
  });

  console.log(`✅ Sent comment deletion for post ${postId}`);
}

function handlePostCreated(io, data) {
  const { post, followers } = data;

  // Notify followers about new post
  if (followers && followers.length > 0) {
    followers.forEach((followerId) => {
      io.to(`user:${followerId}`).emit("notification", {
        type: "new_post",
        message: `${post.authorName} created a new post`,
        data: post,
        createdAt: new Date(),
      });
    });
  }

  console.log(`✅ Sent new post notification to ${followers?.length || 0} followers`);
}

function handlePostLiked(io, data) {
  const { postId, postAuthorId, likedBy, likedByName } = data;

  // Notify post author about like
  if (postAuthorId && likedBy !== postAuthorId) {
    io.to(`user:${postAuthorId}`).emit("notification", {
      type: "post_liked",
      message: `${likedByName} liked your post`,
      data: { postId, likedBy },
      createdAt: new Date(),
    });
  }

  console.log(`✅ Sent post like notification for post ${postId}`);
}

function handleLikeCreated(io, data) {
  const { commentId, commentAuthorId, likedBy, likedByName } = data;

  // Notify comment author about like
  if (commentAuthorId && likedBy !== commentAuthorId) {
    io.to(`user:${commentAuthorId}`).emit("notification", {
      type: "comment_liked",
      message: `${likedByName} liked your comment`,
      data: { commentId, likedBy },
      createdAt: new Date(),
    });
  }

  console.log(`✅ Sent comment like notification for comment ${commentId}`);
}
