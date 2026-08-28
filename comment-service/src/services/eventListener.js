import amqp from "amqplib";
import prisma from "../lib/prisma.js";

const QUEUE = "comment-service.post-events.v1";
const DEAD_LETTER_EXCHANGE = "events.dlx";
const MAX_RETRIES = 3;
let channel;
let connecting = false;

export async function processPostEvent(event, db = prisma) {
  if (!event?.eventId || !event?.eventType || event.version !== 1) {
    throw new Error("Invalid event envelope");
  }

  try {
    return await db.$transaction(async (tx) => {
      const processed = await tx.processedEvent.findUnique({
        where: { eventId: event.eventId },
      });
      if (processed) return false;

      if (event.eventType === "post.deleted") {
        await tx.comment.deleteMany({ where: { postId: event.data.postId } });
      }

      await tx.processedEvent.create({
        data: { eventId: event.eventId, eventType: event.eventType },
      });
      return true;
    });
  } catch (error) {
    if (error.code === "P2002") return false;
    throw error;
  }
}

async function retryOrDeadLetter(msg, event, error) {
  const retries = Number(msg.properties.headers?.["x-retry-count"] || 0);
  console.error("Error processing event:", error.message, { retries });

  if (retries >= MAX_RETRIES) {
    channel.nack(msg, false, false);
    return;
  }

  channel.publish(msg.fields.exchange, msg.fields.routingKey, msg.content, {
    persistent: true,
    contentType: "application/json",
    messageId: event?.eventId || msg.properties.messageId,
    headers: { ...msg.properties.headers, "x-retry-count": retries + 1 },
  });
  await channel.waitForConfirms();
  channel.ack(msg);
}

export async function initEventListener() {
  if (channel || connecting) return;
  connecting = true;
  try {
    const connection = await amqp.connect(process.env.RABBITMQ_URL);
    connection.on("close", () => {
      channel = undefined;
      setTimeout(() => void initEventListener(), 5000);
    });
    connection.on("error", () => {});
    channel = await connection.createConfirmChannel();
    await channel.assertExchange("posts", "topic", { durable: true });
    await channel.assertExchange(DEAD_LETTER_EXCHANGE, "direct", { durable: true });
    await channel.assertQueue(`${QUEUE}.dlq`, { durable: true });
    await channel.bindQueue(`${QUEUE}.dlq`, DEAD_LETTER_EXCHANGE, QUEUE);
    await channel.assertQueue(QUEUE, {
      durable: true,
      arguments: {
        "x-dead-letter-exchange": DEAD_LETTER_EXCHANGE,
        "x-dead-letter-routing-key": QUEUE,
      },
    });
    await channel.bindQueue(QUEUE, "posts", "post.deleted");
    await channel.prefetch(10);

    await channel.consume(QUEUE, async (msg) => {
      if (!msg) return;
      let event;
      try {
        event = JSON.parse(msg.content.toString());
        await processPostEvent(event);
        channel.ack(msg);
      } catch (error) {
        await retryOrDeadLetter(msg, event || {}, error);
      }
    });
    console.log(`✅ RabbitMQ listener initialized: ${QUEUE}`);
  } catch (error) {
    channel = undefined;
    console.error("❌ RabbitMQ listener failed:", error.message);
    setTimeout(() => void initEventListener(), 5000);
  } finally {
    connecting = false;
  }
}
