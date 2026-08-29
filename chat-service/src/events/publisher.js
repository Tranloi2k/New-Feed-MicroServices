import { ulid } from "ulid";
import { getRabbitChannel } from "../lib/rabbitmq.js";

export async function publishMessageCreated({ message, recipientIds, preview, senderName }) {
  const channel = await getRabbitChannel();
  const event = {
    eventId: ulid(),
    eventType: "chat.message.created",
    version: 1,
    occurredAt: new Date().toISOString(),
    data: {
      conversationId: message.conversationId,
      messageId: message.id,
      senderId: message.senderId,
      senderName,
      recipientIds,
      preview: preview.slice(0, 100),
    },
  };
  channel.publish("chat", "chat.message.created", Buffer.from(JSON.stringify(event)), {
    persistent: true,
    contentType: "application/json",
    messageId: event.eventId,
  });
  await channel.waitForConfirms();
}
