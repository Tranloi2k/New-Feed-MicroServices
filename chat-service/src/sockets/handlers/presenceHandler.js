import { getActiveMemberships, getPeerIds } from "../../services/conversationService.js";
import { getOnlineUserIds, markOffline, markOnline } from "../../services/presenceService.js";
import { socketRateLimits } from "../../config/rateLimits.js";
import { allowSocketEvent } from "../rateLimit.js";

async function broadcast(socket, memberships, status) {
  for (const { conversationId } of memberships) {
    socket.to(`conversation:${conversationId}`).emit("presence:update", { userId: socket.data.userId, status });
  }
}

/**
 * presence:update only carries transitions, so a socket that just connected
 * would miss every peer who came online before it. Send the current state once.
 */
async function sendSnapshot(socket, memberships) {
  try {
    const conversationIds = memberships.map(({ conversationId }) => conversationId);
    const peerIds = await getPeerIds(socket.data.userId, conversationIds);
    socket.emit("presence:snapshot", { userIds: await getOnlineUserIds(peerIds) });
  } catch (error) {
    // Presence is decorative; a failed snapshot must not drop the connection.
    console.error("Presence snapshot failed:", error.message);
  }
}

export async function registerPresenceHandler(io, socket, memberships) {
  await markOnline(socket.data.userId);
  await broadcast(socket, memberships, "online");
  await sendSnapshot(socket, memberships);
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
