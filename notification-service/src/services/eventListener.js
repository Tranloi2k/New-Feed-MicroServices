import amqp from "amqplib";
import prisma from "../lib/prisma.js";
import { createNotification } from "./notificationStore.js";
import { getFollowerIds } from "./recipientResolver.js";
import { isChatUserOnline } from "../config/redis.js";

const QUEUE = "notification-service.events.v1";
const DEAD_LETTER_EXCHANGE = "events.dlx";
const MAX_RETRIES = 3;
let channel;
let connecting = false;

async function persistNotification(tx, actions, userId, payload) {
  if (!userId) return;
  const saved = await createNotification(
    {
      userId,
      type: payload.type,
      message: payload.message,
      data: payload.data ?? null,
    },
    tx
  );
  actions.push({ room: `user:${userId}`, name: "notification", payload: saved });
}

async function buildActions(tx, event) {
  const actions = [];
  const { eventType, data } = event;

  if (eventType === "comment.created") {
    const { comment, postId, postAuthorId } = data;
    if (postAuthorId && comment.authorId !== postAuthorId) {
      await persistNotification(tx, actions, postAuthorId, {
        type: "new_comment",
        message: `${comment.authorName} commented on your post`,
        data: { postId, commentId: comment.id },
      });
    }
    actions.push({ room: `post:${postId}`, name: "new_comment", payload: { postId, comment } });
  } else if (eventType === "comment.updated") {
    actions.push({ room: `post:${data.postId}`, name: "comment_updated", payload: data });
  } else if (eventType === "comment.deleted") {
    actions.push({ room: `post:${data.postId}`, name: "comment_deleted", payload: data });
  } else if (eventType === "post.created") {
    for (const followerId of data.followers || []) {
      await persistNotification(tx, actions, followerId, {
        type: "new_post",
        message: "Someone you follow created a new post",
        data: { postId: data.postId, authorId: data.userId },
      });
    }
  } else if (eventType === "post.liked") {
    if (data.postAuthorId && data.likedBy !== data.postAuthorId) {
      await persistNotification(tx, actions, data.postAuthorId, {
        type: "post_liked",
        message: `${data.likedByName || "Someone"} liked your post`,
        data: { postId: data.postId, likedBy: data.likedBy },
      });
    }
  } else if (eventType === "like.created") {
    if (data.commentAuthorId && data.likedBy !== data.commentAuthorId) {
      await persistNotification(tx, actions, data.commentAuthorId, {
        type: "comment_liked",
        message: `${data.likedByName || "Someone"} liked your comment`,
        data: { commentId: data.commentId, likedBy: data.likedBy },
      });
    }
  } else if (eventType === "chat.message.created") {
    for (const userId of data.offlineRecipientIds || []) {
      await persistNotification(tx, actions, userId, {
        type: "chat_message",
        message: `${data.senderName || "Someone"}: ${String(data.preview || "").slice(0, 100)}`,
        data: { type: "chat", conversationId: data.conversationId, messageId: data.messageId },
      });
    }
  }

  return actions;
}

export function validateEventContract(event) {
  if (!event?.eventId || !event?.eventType || event.version !== 1 || !event.data) {
    throw new Error("Invalid or unsupported event envelope");
  }
  const positiveId = (value) => Number.isSafeInteger(value) && value > 0;
  if (event.eventType === "post.created" && (!positiveId(event.data.postId) || !positiveId(event.data.userId))) {
    throw new Error("Invalid post.created contract");
  }
  if (
    event.eventType === "comment.created" &&
    (!positiveId(event.data.postId) ||
      !positiveId(event.data.postAuthorId) ||
      !positiveId(event.data.comment?.id) ||
      !positiveId(event.data.comment?.authorId))
  ) {
    throw new Error("Invalid comment.created contract");
  }
  if (
    event.eventType === "chat.message.created" &&
    (!event.data.conversationId ||
      !event.data.messageId ||
      !positiveId(event.data.senderId) ||
      !Array.isArray(event.data.recipientIds) ||
      event.data.recipientIds.some((id) => !positiveId(id)))
  ) {
    throw new Error("Invalid chat.message.created contract");
  }
}

export async function processEventOnce(
  io,
  event,
  db = prisma,
  { resolveFollowerIds = getFollowerIds, isUserOnline = isChatUserOnline } = {}
) {
  validateEventContract(event);

  const alreadyProcessed = await db.processedEvent.findUnique({
    where: { eventId: event.eventId },
  });
  if (alreadyProcessed) return false;

  let enrichedEvent =
    event.eventType === "post.created"
      ? {
          ...event,
          data: {
            ...event.data,
            followers: await resolveFollowerIds(event.data.userId),
          },
        }
      : event;
  if (event.eventType === "chat.message.created") {
    const statuses = await Promise.all(event.data.recipientIds.map(async (userId) => ({ userId, online: await isUserOnline(userId) })));
    enrichedEvent = {
      ...event,
      data: { ...event.data, offlineRecipientIds: statuses.filter(({ online }) => !online).map(({ userId }) => userId) },
    };
  }

  let actions;
  try {
    actions = await db.$transaction(async (tx) => {
      const processed = await tx.processedEvent.findUnique({
        where: { eventId: event.eventId },
      });
      if (processed) return null;

      const pendingActions = await buildActions(tx, enrichedEvent);
      await tx.processedEvent.create({
        data: { eventId: event.eventId, eventType: event.eventType },
      });
      return pendingActions;
    });
  } catch (error) {
    if (error.code === "P2002") return false;
    throw error;
  }

  if (!actions) return false;
  for (const action of actions) {
    io.to(action.room).emit(action.name, action.payload);
  }
  return true;
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

export async function initEventListener(io) {
  if (channel || connecting) return;
  connecting = true;
  try {
    const connection = await amqp.connect(process.env.RABBITMQ_URL);
    connection.on("close", () => {
      channel = undefined;
      setTimeout(() => void initEventListener(io), 5000);
    });
    connection.on("error", () => {});
    channel = await connection.createConfirmChannel();

    for (const exchange of ["comments", "posts", "likes", "chat"]) {
      await channel.assertExchange(exchange, "topic", { durable: true });
    }
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

    const bindings = [
      ["comments", "comment.created"],
      ["comments", "comment.updated"],
      ["comments", "comment.deleted"],
      ["posts", "post.created"],
      ["posts", "post.liked"],
      ["likes", "like.created"],
      ["chat", "chat.message.created"],
    ];
    for (const [exchange, routingKey] of bindings) {
      await channel.bindQueue(QUEUE, exchange, routingKey);
    }
    await channel.prefetch(10);

    await channel.consume(QUEUE, async (msg) => {
      if (!msg) return;
      let event;
      try {
        event = JSON.parse(msg.content.toString());
        await processEventOnce(io, event);
        channel.ack(msg);
      } catch (error) {
        await retryOrDeadLetter(msg, event, error);
      }
    });
    console.log(`RabbitMQ event listener initialized: ${QUEUE}`);
  } catch (error) {
    channel = undefined;
    console.error("RabbitMQ listener failed:", error.message);
    setTimeout(() => void initEventListener(io), 5000);
  } finally {
    connecting = false;
  }
}
