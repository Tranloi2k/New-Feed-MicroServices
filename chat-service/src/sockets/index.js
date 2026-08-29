import { createAdapter } from "@socket.io/redis-adapter";
import { redis, redisSub } from "../lib/redis.js";
import { socketAuth } from "../middleware/socketAuth.js";
import { getActiveMemberships } from "../services/conversationService.js";
import { registerMessageHandler } from "./handlers/messageHandler.js";
import { registerTypingHandler } from "./handlers/typingHandler.js";
import { registerPresenceHandler } from "./handlers/presenceHandler.js";

export function registerSockets(io) {
  io.adapter(createAdapter(redis, redisSub));
  io.use(socketAuth);
  io.on("connection", async (socket) => {
    try {
      const memberships = await getActiveMemberships(socket.data.userId);
      await socket.join(`user:${socket.data.userId}`);
      await socket.join(memberships.map(({ conversationId }) => `conversation:${conversationId}`));
      registerMessageHandler(io, socket);
      registerTypingHandler(io, socket);
      await registerPresenceHandler(io, socket, memberships);
    } catch (error) {
      console.error("Socket initialization failed:", error.message);
      socket.disconnect(true);
    }
  });
}
