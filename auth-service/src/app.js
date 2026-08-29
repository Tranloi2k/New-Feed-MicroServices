import "dotenv/config";
import express from "express";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import cors from "cors";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import authRoutes from "./routes/authRoutes.js";
import userRoutes from "./routes/userRoutes.js";
import {
  checkRedisHealth,
  closeRedisConnection,
  createRedisClient,
} from "./config/redis.js";
import prisma from "./lib/prisma.js";
import { validateEnv } from "./config/env.js";
import { logger } from "./utils/logger.js";

export function createApp() {
  const app = express();

  app.disable("x-powered-by");
  app.use(helmet());
  app.use(
    cors({
      origin: process.env.CLIENT_URL,
      credentials: true,
    })
  );
  app.use(express.json({ limit: "64kb" }));
  app.use(cookieParser());
  app.use((req, res, next) => {
    req.requestId = req.get("x-request-id") || randomUUID();
    res.setHeader("x-request-id", req.requestId);
    next();
  });

  app.use("/api", authRoutes);
  app.use("/api/users", userRoutes);

  app.get("/health/live", (_req, res) => {
    res.json({ success: true, service: "auth-service" });
  });

  const readiness = async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      const redis = await checkRedisHealth();
      const ready = redis.status !== "unhealthy";
      return res.status(ready ? 200 : 503).json({
        success: ready,
        service: "auth-service",
        dependencies: { postgres: "healthy", redis: redis.status },
      });
    } catch (error) {
      return res.status(503).json({
        success: false,
        service: "auth-service",
        dependencies: { postgres: "unhealthy" },
      });
    }
  };
  app.get("/health", readiness);
  app.get("/health/ready", readiness);

  app.use((err, _req, res, _next) => {
    logger.error("request.failed", { error: err, requestId: _req.requestId });
    const status = Number.isInteger(err.status) ? err.status : 500;
    res.status(status).json({
      success: false,
      message:
        status >= 500 && process.env.NODE_ENV === "production"
          ? "Internal server error"
          : err.message || "Internal server error",
    });
  });

  return app;
}

export function createAuthRuntime() {
  const { port } = validateEnv();
  createRedisClient();
  const app = createApp();
  const server = createServer(app);
  const sockets = new Set();
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });

  async function start() {
    await new Promise((resolveStart, rejectStart) => {
      server.once("error", rejectStart);
      server.listen(port, () => {
        server.off("error", rejectStart);
        resolveStart();
      });
    });
    logger.info("server.started", { port });
  }

  let shutdownPromise;
  function shutdown(signal = "shutdown") {
    if (shutdownPromise) return shutdownPromise;
    shutdownPromise = (async () => {
      logger.info("server.shutting_down", { signal });
      await new Promise((resolveClose) => {
        const timeout = setTimeout(() => {
          for (const socket of sockets) socket.destroy();
        }, 10_000);
        timeout.unref();
        server.close(() => {
          clearTimeout(timeout);
          resolveClose();
        });
      });
      await Promise.allSettled([closeRedisConnection(), prisma.$disconnect()]);
    })();
    return shutdownPromise;
  }

  return { app, server, start, shutdown };
}

export async function startAuthService() {
  const runtime = createAuthRuntime();
  await runtime.start();
  const stop = (signal) => {
    runtime.shutdown(signal).then(() => process.exit(0)).catch(() => process.exit(1));
  };
  process.once("SIGTERM", () => stop("SIGTERM"));
  process.once("SIGINT", () => stop("SIGINT"));
  return runtime;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
  startAuthService().catch((error) => {
    logger.error("server.start_failed", { error });
    process.exit(1);
  });
}
