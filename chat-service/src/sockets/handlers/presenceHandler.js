import { getActiveMemberships } from "../../services/conversationService.js";
import { markOffline, markOnline } from "../../services/presenceService.js";
import { socketRateLimits } from "../../config/rateLimits.js";
import { allowSocketEvent } from "../rateLimit.js";

async function broadcast(socket, memberships, status) {
  for (const { conversationId } of memberships) {
    socket.to(`conversation:${conversationId}`).emit("presence:update", { userId: socket.data.userId, status });
  }
}

export async function registerPresenceHandler(io, socket, memberships) {
  await markOnline(socket.data.userId);
  await broadcast(socket, memberships, "online");
  socket.on("presence:ping", async () => {
    try {
      const rateLimit = await allowSocketEvent(
        socket,
        "presence:ping",
        socketRateLimits.presencePing
      );
      if (rateLimit.allowed) await markOnline(socket.data.userId);
    } catch (error) {
      console.error("Presence heartbeat failed:", error.message);
    }
  });
  socket.on("disconnect", async () => {
    try {
      const remaining = await io.in(`user:${socket.data.userId}`).fetchSockets();
      if (remaining.length) return;
      await markOffline(socket.data.userId);
      await broadcast(socket, await getActiveMemberships(socket.data.userId), "offline");
    } catch (error) {
      console.error("Presence disconnect failed:", error.message);
    }
  });
}
