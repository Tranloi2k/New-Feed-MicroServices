import { assertMember } from "../../services/conversationService.js";
import { setTyping } from "../../services/presenceService.js";

export function registerTypingHandler(io, socket) {
  async function update(input, isTyping) {
    try {
      const conversationId = String(input?.conversationId || "");
      await assertMember(conversationId, socket.data.userId);
      await setTyping(conversationId, socket.data.userId, isTyping);
      socket.to(`conversation:${conversationId}`).emit("typing:update", {
        conversationId,
        userId: socket.data.userId,
        isTyping,
      });
    } catch {
      // Typing is ephemeral; invalid or stale membership is intentionally ignored.
    }
  }
  socket.on("typing:start", (input) => void update(input, true));
  socket.on("typing:stop", (input) => void update(input, false));
}
