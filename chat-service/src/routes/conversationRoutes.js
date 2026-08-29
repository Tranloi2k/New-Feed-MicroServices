import express from "express";
import { conversationController } from "../controllers/conversationController.js";
import { getMessages } from "../controllers/messageController.js";
import { sync } from "../controllers/syncController.js";
import { restRateLimits } from "../config/rateLimits.js";
import { userRateLimit } from "../middleware/rateLimit.js";

export function createConversationRoutes(io) {
  const router = express.Router();
  const controller = conversationController(io);
  router.get("/conversations", controller.list);
  router.post(
    "/conversations",
    userRateLimit("conversation-create", restRateLimits.conversationCreate),
    controller.create
  );
  router.get(
    "/conversations/:id/messages",
    userRateLimit("history", restRateLimits.history),
    getMessages
  );
  router.post("/conversations/:id/read", controller.read);
  router.get("/sync", userRateLimit("sync", restRateLimits.sync), sync);
  return router;
}
