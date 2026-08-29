import { createMessage, getRecipients } from "../../services/messageService.js";
import { incrementUnread } from "../../services/unreadService.js";
import { publishMessageCreated } from "../../events/publisher.js";
import { getUserById } from "../../services/userService.js";
import { socketRateLimits } from "../../config/rateLimits.js";
import { allowSocketEvent } from "../rateLimit.js";

export function registerMessageHandler(io, socket) {
  socket.on("message:send", async (input = {}) => {
    const clientMessageId = input.clientMessageId;
    try {
      const rateLimit = await allowSocketEvent(
        socket,
        "message:send",
        socketRateLimits.messageSend
      );
      if (!rateLimit.allowed) {
        socket.emit("message:error", {
          clientMessageId,
          code: "RATE_LIMIT_EXCEEDED",
          message: "Bạn đang gửi tin nhắn quá nhanh.",
          retryAfter: rateLimit.retryAfter,
        });
        return;
      }

      const { message, created } = await createMessage(socket.data.userId, input);
      socket.emit("message:ack", {
        clientMessageId: message.clientMessageId,
        id: message.id,
        createdAt: message.createdAt,
      });
      if (!created) return;

      io.to(`conversation:${message.conversationId}`).emit("message:new", { message });
      const recipients = await getRecipients(message.conversationId, message.senderId);
      const sender = await getUserById(message.senderId);
      const results = await Promise.allSettled([
        incrementUnread(recipients.all, message.conversationId),
        publishMessageCreated({
          message,
          recipientIds: recipients.notify,
          preview: message.content,
          senderName: sender.username,
        }),
      ]);
      for (const result of results) {
        if (result.status === "rejected") console.error("Post-message side effect failed:", result.reason);
      }
    } catch (error) {
      socket.emit("message:error", { clientMessageId, message: error.status < 500 ? error.message : "Message could not be sent" });
    }
  });
}
