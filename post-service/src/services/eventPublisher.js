import amqp from "amqplib";
import prisma from "../lib/prisma.js";

const EXCHANGE = "posts";
const LOCK_TIMEOUT_MS = 60_000;
let channel;
let pollTimer;
let polling = false;

export function enqueueEvent(tx, eventType, payload, correlationId = null) {
  return tx.outboxEvent.create({ data: { eventType, payload, correlationId } });
}

async function getChannel() {
  if (channel) return channel;
  const connection = await amqp.connect(process.env.RABBITMQ_URL);
  connection.on("close", () => { channel = undefined; });
  connection.on("error", () => {});
  channel = await connection.createConfirmChannel();
  await channel.assertExchange(EXCHANGE, "topic", { durable: true });
  return channel;
}

async function releaseStaleLocks(now) {
  await prisma.outboxEvent.updateMany({
    where: {
      status: "PROCESSING",
      lockedAt: { lt: new Date(now.getTime() - LOCK_TIMEOUT_MS) },
    },
    data: { status: "PENDING", lockedAt: null },
  });
}

export async function publishPendingEvents() {
  if (polling) return;
  polling = true;
  const now = new Date();
  try {
    await releaseStaleLocks(now);
    const events = await prisma.outboxEvent.findMany({
      where: { status: "PENDING", availableAt: { lte: now } },
      orderBy: { createdAt: "asc" },
      take: 50,
    });

    for (const event of events) {
      const claimed = await prisma.outboxEvent.updateMany({
        where: { id: event.id, status: "PENDING" },
        data: { status: "PROCESSING", lockedAt: new Date() },
      });
      if (claimed.count === 0) continue;

      try {
        const ch = await getChannel();
        const envelope = {
          eventId: event.id,
          eventType: event.eventType,
          version: 1,
          occurredAt: event.createdAt.toISOString(),
          correlationId: event.correlationId,
          data: event.payload,
        };
        ch.publish(EXCHANGE, event.eventType, Buffer.from(JSON.stringify(envelope)), {
          persistent: true,
          contentType: "application/json",
          messageId: event.id,
          timestamp: event.createdAt.getTime(),
        });
        await ch.waitForConfirms();
        await prisma.outboxEvent.update({
          where: { id: event.id },
          data: { status: "PUBLISHED", publishedAt: new Date(), lockedAt: null },
        });
      } catch (error) {
        channel = undefined;
        const attempts = event.attempts + 1;
        await prisma.outboxEvent.update({
          where: { id: event.id },
          data: {
            status: "PENDING",
            attempts,
            lockedAt: null,
            lastError: error.message,
            availableAt: new Date(Date.now() + Math.min(60_000, 1000 * 2 ** attempts)),
          },
        });
      }
    }
  } catch (error) {
    console.error("Outbox publisher error:", error.message);
  } finally {
    polling = false;
  }
}

export function initOutboxPublisher() {
  if (pollTimer) return;
  void publishPendingEvents();
  pollTimer = setInterval(() => void publishPendingEvents(), 1000);
  pollTimer.unref();
}
