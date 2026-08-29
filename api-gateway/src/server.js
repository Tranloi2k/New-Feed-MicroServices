import "dotenv/config";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./app.js";
import {
  getProxyLogLevel,
  getServices,
  logServiceUrls,
  validateEnv,
} from "./config/services.js";
import {
  closeRedisConnection,
  createRedisClient,
} from "./config/redis.js";
import { createServiceProxies } from "./proxy/serviceProxies.js";
import { logger } from "./utils/logger.js";
import { attachWebSocketRouter } from "./websocket/websocketRouter.js";

export function createGatewayRuntime({ port = process.env.PORT || 8080 } = {}) {
  validateEnv();
  createRedisClient();

  const services = getServices();
  const proxies = createServiceProxies({
    services,
    logLevel: getProxyLogLevel(),
  });
  const app = createApp({ proxies });
  const httpServer = createServer(app);
  const activeSockets = new Set();
  let shutdownPromise = null;

  httpServer.on("connection", (socket) => {
    activeSockets.add(socket);
    socket.once("close", () => activeSockets.delete(socket));
  });
  attachWebSocketRouter(httpServer, proxies);

  async function start() {
    await new Promise((resolveStart, rejectStart) => {
      const handleError = (error) => rejectStart(error);
      httpServer.once("error", handleError);
      httpServer.listen(port, () => {
        httpServer.off("error", handleError);
        resolveStart();
      });
    });
    logger.info(`API Gateway running on port ${port}`);
    logServiceUrls(services);
  }

  function shutdown(signal = "shutdown") {
    if (shutdownPromise) return shutdownPromise;

    shutdownPromise = (async () => {
      logger.info(`${signal} received, shutting down gracefully...`);
      await new Promise((resolveClose) => {
        const forceCloseTimer = setTimeout(() => {
          logger.warn("Graceful shutdown timed out; closing active connections");
          for (const socket of activeSockets) socket.destroy();
        }, 10_000);
        forceCloseTimer.unref();

        httpServer.close(() => {
          clearTimeout(forceCloseTimer);
          logger.info("HTTP server closed");
          resolveClose();
        });
      });
      await closeRedisConnection();
    })();

    return shutdownPromise;
  }

  return { app, httpServer, proxies, services, start, shutdown };
}

export async function startGateway() {
  const runtime = createGatewayRuntime();
  await runtime.start();

  const stop = (signal) => {
    runtime
      .shutdown(signal)
      .then(() => process.exit(0))
      .catch((error) => {
        logger.error("Gateway shutdown failed", error);
        process.exit(1);
      });
  };
  process.once("SIGTERM", () => stop("SIGTERM"));
  process.once("SIGINT", () => stop("SIGINT"));
  return runtime;
}

const isMainModule =
  process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isMainModule) {
  startGateway().catch((error) => {
    logger.error("Failed to start API Gateway", error);
    process.exit(1);
  });
}
