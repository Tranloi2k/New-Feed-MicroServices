import amqp from "amqplib";
import prisma from "../lib/prisma.js";

let channel = null;

export async function initEventListener() {
  try {
    const connection = await amqp.connect(
      process.env.RABBITMQ_URL
    );
    channel = await connection.createChannel();
    await channel.assertExchange("posts", "topic", { durable: true });

    const q = await channel.assertQueue("", { exclusive: true });

    // Subscribe to post deletion events
    channel.bindQueue(q.queue, "posts", "post.deleted");

    channel.consume(q.queue, async (msg) => {
      if (msg) {
        try {
          const event = JSON.parse(msg.content.toString());
          console.log(`📥 Received event: ${event.eventType}`, event.data);

          if (event.eventType === "post.deleted") {
            await handlePostDeleted(event.data);
          }

          channel.ack(msg);
        } catch (error) {
          console.error("Error processing event:", error);
          channel.nack(msg, false, false);
        }
      }
    });

    console.log("✅ RabbitMQ event listener initialized");
  } catch (error) {
    console.error("❌ RabbitMQ listener failed:", error.message);
  }
}

async function handlePostDeleted({ postId }) {
  try {
    // Delete all comments for this post
    const result = await prisma.comment.deleteMany({
      where: { postId },
    });

    console.log(`🗑️ Deleted ${result.count} comments for post ${postId}`);
  } catch (error) {
    console.error("Error handling post deletion:", error);
  }
}
