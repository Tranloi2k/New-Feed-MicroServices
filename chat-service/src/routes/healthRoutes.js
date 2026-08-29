import express from "express";
import prisma from "../lib/prisma.js";
import { isRedisReady } from "../lib/redis.js";

const router = express.Router();
router.get("/live", (_req, res) => res.json({ status: "ok", service: "chat-service" }));
router.get("/ready", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    if (!(await isRedisReady())) throw new Error("Redis is not ready");
    res.json({ status: "ready", service: "chat-service" });
  } catch (error) {
    res.status(503).json({ status: "not_ready", message: error.message });
  }
});
export default router;
