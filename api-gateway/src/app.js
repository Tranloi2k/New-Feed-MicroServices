import "dotenv/config";
import express from "express";
import { createServer } from "http";
import cors from "cors";
import compression from "compression";
import cookieParser from "cookie-parser";
import { createProxyMiddleware } from "http-proxy-middleware";
import {
  authenticateToken,
  optionalAuthenticateToken,
} from "./middleware/auth.js";
import { authenticateUpgrade } from "./middleware/upgradeAuth.js";
import { requireServiceSecret } from "./middleware/adminAuth.js";
import { createRateLimiter } from "./middleware/rateLimiter.js";
import {
  getAllCircuitBreakerStatuses,
  resetCircuitBreaker,
} from "./middleware/circuitBreaker.js";
import { createCircuitBreakerProxy } from "./middleware/circuitBreakerProxy.js";
import { createRedisClient } from "./config/redis.js";
import {
  validateEnv,
  SERVICES,
  getProxyLogLevel,
  logServiceUrls,
} from "./config/services.js";
import {
  restreamBody,
  forwardUserHeaders,
  attachWsSocketLogging,
  handleProxyError,
} from "./utils/proxyHelpers.js";
import { logger } from "./utils/logger.js";

validateEnv();

const app = express();
const httpServer = createServer(app);
const proxyLogLevel = getProxyLogLevel();

app.set("trust proxy", 1);

createRedisClient();

app.use(
  cors({
    origin: process.env.CLIENT_URL,
    credentials: true,
  })
);
app.use(cookieParser());
app.use(
  compression({
    filter: (req, res) => {
      if (req.headers["x-no-compression"]) {
        return false;
      }
      return compression.filter(req, res);
    },
    level: 6,
    threshold: 1024,
  })
);

const rateLimiter = createRateLimiter();
app.use(rateLimiter);

// --- Notification WebSocket proxy ---
const notificationWsProxy = createProxyMiddleware({
  target: SERVICES.notification,
  changeOrigin: true,
  ws: true,
  logLevel: proxyLogLevel,
  pathRewrite: (path) =>
    path.replace(/^\/notifications\/socket\.io/, "/socket.io"),
  onProxyReq: (proxyReq, req) => {
    forwardUserHeaders(proxyReq, req);
  },
  onProxyReqWs: (proxyReq, req, socket) => {
    forwardUserHeaders(proxyReq, req);
    attachWsSocketLogging(socket, "Notification WS");
  },
  onError: (err, req, res) => {
    handleProxyError(err, req, res, {
      target: SERVICES.notification,
      message: "Notification gateway proxy error",
    });
  },
});

app.use("/notifications/socket.io", authenticateToken, notificationWsProxy);

// --- GraphQL proxies (explicit endpoints only) ---
const graphqlPathRewrite = { "^/graphql/post": "/graphql" };
const commentGraphqlPathRewrite = { "^/graphql/comment": "/graphql" };

const commentGraphQLHttpProxy = createCircuitBreakerProxy(
  "comment",
  SERVICES.comment,
  {
    ws: false,
    logLevel: proxyLogLevel,
    pathRewrite: commentGraphqlPathRewrite,
    onProxyReq: (proxyReq, req) => {
      forwardUserHeaders(proxyReq, req);
      restreamBody(proxyReq, req);
    },
  }
);

const postGraphQLHttpProxy = createCircuitBreakerProxy("post", SERVICES.post, {
  ws: false,
  logLevel: proxyLogLevel,
  pathRewrite: graphqlPathRewrite,
  onProxyReq: (proxyReq, req) => {
    forwardUserHeaders(proxyReq, req);
    restreamBody(proxyReq, req);
  },
});

const commentGraphQLWsProxy = createProxyMiddleware({
  target: SERVICES.comment,
  changeOrigin: true,
  ws: true,
  logLevel: proxyLogLevel,
  pathRewrite: commentGraphqlPathRewrite,
  onProxyReq: (proxyReq, req) => {
    forwardUserHeaders(proxyReq, req);
  },
  onProxyReqWs: (proxyReq, req, socket) => {
    forwardUserHeaders(proxyReq, req);
    attachWsSocketLogging(socket, "GraphQL Comment WS");
  },
  onError: (err, req, res) => {
    handleProxyError(err, req, res, {
      target: SERVICES.comment,
      message: "Gateway proxy error",
    });
  },
});

const graphqlJson = express.json({ limit: "1mb" });

app.use(
  "/graphql/post",
  optionalAuthenticateToken,
  graphqlJson,
  postGraphQLHttpProxy
);
app.use(
  "/graphql/comment",
  authenticateToken,
  graphqlJson,
  commentGraphQLHttpProxy
);

// --- WebSocket upgrade (auth required) ---
httpServer.on("upgrade", (req, socket, head) => {
  if (!authenticateUpgrade(req, socket)) {
    return;
  }

  if (req.url.startsWith("/notifications/socket.io")) {
    notificationWsProxy.upgrade(req, socket, head);
    return;
  }

  const url = req.url.split("?")[0];
  if (
    req.headers.upgrade?.toLowerCase() === "websocket" &&
    url.startsWith("/graphql/comment")
  ) {
    commentGraphQLWsProxy.upgrade(req, socket, head);
  }
});

// --- Health & admin ---
app.get("/health", (req, res) => {
  res.json({
    success: true,
    service: "api-gateway",
    timestamp: new Date().toISOString(),
  });
});

app.get("/health/circuit-breakers", (req, res) => {
  const statuses = getAllCircuitBreakerStatuses();
  const allHealthy = Object.values(statuses).every((s) => s.healthy);

  res.status(allHealthy ? 200 : 503).json({
    success: allHealthy,
    service: "api-gateway",
    circuitBreakers: statuses,
    timestamp: new Date().toISOString(),
  });
});

app.post(
  "/admin/circuit-breakers/:service/reset",
  requireServiceSecret,
  (req, res) => {
    const { service } = req.params;
    const reset = resetCircuitBreaker(service);

    if (reset) {
      res.json({
        success: true,
        message: `Circuit breaker reset for ${service}`,
      });
    } else {
      res.status(404).json({
        success: false,
        message: `Circuit breaker not found for ${service}`,
      });
    }
  }
);

// --- Service proxies ---
app.get(
  "/api/auth/me",
  authenticateToken,
  createCircuitBreakerProxy("auth", SERVICES.auth, {
    pathRewrite: { "^/api/auth/me": "/api/me" },
    logLevel: proxyLogLevel,
    onProxyReq: forwardUserHeaders,
  })
);

app.use(
  "/api/auth",
  express.json(),
  createCircuitBreakerProxy("auth", SERVICES.auth, {
    pathRewrite: { "^/api/auth": "/api" },
    logLevel: proxyLogLevel,
    onProxyReq: restreamBody,
  })
);

const usersProxy = createCircuitBreakerProxy("auth", SERVICES.auth, {
  pathRewrite: { "^/api/users": "/api/users" },
  logLevel: proxyLogLevel,
  onProxyReq: forwardUserHeaders,
});

app.get(
  "/api/users/username/:username",
  optionalAuthenticateToken,
  usersProxy
);
app.get(
  "/api/users/:id/profile",
  optionalAuthenticateToken,
  usersProxy
);
app.get(
  "/api/users/:id/followers",
  optionalAuthenticateToken,
  usersProxy
);
app.get(
  "/api/users/:id/following",
  optionalAuthenticateToken,
  usersProxy
);

app.patch(
  "/api/users/me/profile",
  authenticateToken,
  express.json(),
  usersProxy
);
app.post("/api/users/:id/follow", authenticateToken, usersProxy);
app.delete("/api/users/:id/follow", authenticateToken, usersProxy);

app.use(
  "/api/notifications",
  authenticateToken,
  createCircuitBreakerProxy("notification", SERVICES.notification, {
    pathRewrite: { "^/api/notifications": "/api/notifications" },
    logLevel: proxyLogLevel,
    onProxyReq: forwardUserHeaders,
  })
);

app.use(
  "/api/media",
  authenticateToken,
  createCircuitBreakerProxy("media", SERVICES.media, {
    pathRewrite: { "^/api/media": "/api/media" },
    logLevel: proxyLogLevel,
    onProxyReq: forwardUserHeaders,
  })
);

app.use(
  "/api/comments",
  authenticateToken,
  express.json(),
  createCircuitBreakerProxy("comment", SERVICES.comment, {
    pathRewrite: { "^/api/comments": "/api/comments" },
    logLevel: proxyLogLevel,
    onProxyReq: (proxyReq, req) => {
      forwardUserHeaders(proxyReq, req);
      restreamBody(proxyReq, req);
    },
  })
);

app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "NewFeed API Gateway",
    version: "1.0.0",
    endpoints: {
      auth: "/api/auth",
      authMe: "/api/auth/me",
      users: "/api/users",
      media: "/api/media",
      comments: "/api/comments",
      notifications: "/api/notifications",
      graphqlPost: "/graphql/post",
      graphqlComment: "/graphql/comment",
      notificationsWs: "/notifications/socket.io",
    },
  });
});

app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "Route not found",
  });
});

app.use((err, req, res, next) => {
  logger.error("Gateway error:", err);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || "Internal server error",
  });
});

const PORT = process.env.PORT || 8080;

httpServer.listen(PORT, () => {
  logger.info(`API Gateway running on port ${PORT}`);
  logServiceUrls();
});

let isShuttingDown = false;

async function shutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  logger.info(`${signal} received, shutting down gracefully...`);

  await new Promise((resolve) => {
    httpServer.close(() => {
      logger.info("HTTP server closed");
      resolve();
    });
  });

  const { closeRedisConnection } = await import("./config/redis.js");
  await closeRedisConnection();
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
