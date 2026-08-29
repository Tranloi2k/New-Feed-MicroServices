import express from "express";
import { conversationController } from "../controllers/conversationController.js";
import { getMessages } from "../controllers/messageController.js";
import { sync } from "../controllers/syncController.js";

export function createConversationRoutes(io) {
  const router = express.Router();
  const controller = conversationController(io);
  router.get("/conversations", controller.list);
  router.post("/conversations", controller.create);
  router.get("/conversations/:id/messages", getMessages);
  router.post("/conversations/:id/read", controller.read);
  router.get("/sync", sync);
  return router;
}
