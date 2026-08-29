import "dotenv/config";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { createServer } from "node:http";
import { Server } from "socket.io";
import { env, validateEnv } from "./config/env.js";
import { connectRedis } from "./lib/redis.js";
import { authenticate } from "./middleware/auth.js";
import { createConversationRoutes } from "./routes/conversationRoutes.js";
import healthRoutes from "./routes/healthRoutes.js";
import { registerSockets } from "./sockets/index.js";

validateEnv();
await connectRedis();

export const app = express();
export const httpServer = createServer(app);
export const io = new Server(httpServer, {
  path: "/chat/socket.io",
  cors: { origin: env.clientUrl, credentials: true, methods: ["GET", "POST"] },
});

app.use(cors({ origin: env.clientUrl, credentials: true }));
app.use(cookieParser());
app.use(express.json({ limit: "64kb" }));
app.use("/health", healthRoutes);
app.use("/api/chat", authenticate, createConversationRoutes(io));
app.use((req, res) => res.status(404).json({ success: false, message: "Not found" }));
app.use((error, _req, res, _next) => {
  console.error("Chat request failed:", error);
  res.status(error.status || 500).json({ success: false, message: error.status ? error.message : "Internal server error" });
});

registerSockets(io);
httpServer.listen(env.port, () => console.log(`Chat service running on port ${env.port}`));
