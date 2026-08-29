import express from "express";
import { authenticateToken } from "../middleware/auth.js";

export function createChatRoutes({ proxy, jsonParser }) {
  const router = express.Router();
  router.use("/api/chat", authenticateToken, jsonParser, proxy);
  return router;
}
