import express from "express";
import { authenticateToken } from "../middleware/auth.js";

export function createChatRoutes({ proxies, jsonParser }) {
  const router = express.Router();
  // Socket.IO polling handshakes arrive as plain HTTP; the upgrade itself is
  // routed separately by the WebSocket router.
  router.use("/chat/socket.io", authenticateToken, proxies.chatWebSocket);
  router.use("/api/chat", authenticateToken, jsonParser, proxies.chat);
  return router;
}
