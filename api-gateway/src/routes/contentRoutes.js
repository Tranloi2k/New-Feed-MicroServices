import express from "express";
import { authenticateToken } from "../middleware/auth.js";

export function createContentRoutes({ proxies, jsonParser }) {
  const router = express.Router();

  router.use(
    "/notifications/socket.io",
    authenticateToken,
    proxies.notificationWebSocket
  );
  router.use(
    "/api/notifications",
    authenticateToken,
    proxies.notifications
  );
  router.use("/api/media", authenticateToken, proxies.media);
  router.use(
    "/api/comments",
    authenticateToken,
    jsonParser,
    proxies.comments
  );

  return router;
}
