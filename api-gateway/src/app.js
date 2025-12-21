import "dotenv/config";
import express from "express";
import { createServer } from "http";
import cors from "cors";
import compression from "compression";
import cookieParser from "cookie-parser";
import bodyParser from "body-parser";
import { createProxyMiddleware } from "http-proxy-middleware";
import { authenticateToken } from "./middleware/auth.js";
import { createRateLimiter } from "./middleware/rateLimiter.js";
import {
  getAllCircuitBreakerStatuses,
  resetCircuitBreaker,
} from "./middleware/circuitBreaker.js";
import { createCircuitBreakerProxy } from "./middleware/circuitBreakerProxy.js";
import { createRedisClient } from "./config/redis.js";
import { logger } from "./utils/logger.js";

const app = express();
const httpServer = createServer(app);

// Initialize Redis for rate limiting
createRedisClient();

// Middleware
app.use(
  cors({
    origin: process.env.CLIENT_URL,
    credentials: true,
  })
);
app.use(cookieParser());

// Compression middleware - compress responses
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

// Apply Redis-based rate limiter globally
const rateLimiter = createRateLimiter();
app.use(rateLimiter);

// Service URLs
const SERVICES = {
  auth: process.env.AUTH_SERVICE_URL,
  post: process.env.POST_SERVICE_URL,
  media: process.env.MEDIA_SERVICE_URL,
  comment: process.env.COMMENT_SERVICE_URL,
  notification: process.env.NOTIFICATION_SERVICE_URL,
};
// Notification Service WebSocket & HTTP proxy
const notificationWsProxy = createProxyMiddleware({
  target: SERVICES.notification,
  changeOrigin: true,
  ws: true,
  logLevel: 'debug',
  pathRewrite: (path, req) => {
    // Rewrite all /notifications/socket.io* to /socket.io*
    return path.replace(/^\/notifications\/socket\.io/, '/socket.io');
  },
  onProxyReq: (proxyReq, req) => {
    forwardUserHeaders(proxyReq, req);
  },
  onProxyReqWs: (proxyReq, req, socket) => {
    socket.on("error", (err) => {
      logger.error("[Notification WS] Socket error:", err.message);
    });
    socket.on("close", () => {
      logger.info("[Notification WS] Client disconnected");
    });
  },
  onError: (err, req, res) => {
    logger.error("[Notification Proxy Error]", {
      message: err.message,
      code: err.code,
      target: SERVICES.notification,
    });
    if (res && typeof res.status === 'function' && !res.headersSent) {
      res.status(502).json({
        success: false,
        message: "Notification gateway proxy error",
      });
    }
    if (res && typeof res.destroy === 'function') {
      res.destroy();
    }
  },
});

// Route /notifications/socket.io to notification service (HTTP and WebSocket)
app.use("/notifications/socket.io", authenticateToken,  notificationWsProxy);

// Handle upgrade event for WebSocket at the server level
httpServer.on('upgrade', (req, socket, head) => {
  // Handle Socket.IO for notification service
  if (req.url.startsWith('/notifications/socket.io')) {
    notificationWsProxy.upgrade(req, socket, head);
    return;
  }

  // Handle GraphQL WebSocket subscriptions for comment service
  if (req.url.startsWith('/graphql') && req.headers.upgrade?.toLowerCase() === 'websocket') {
    logger.info(`[WebSocket Upgrade] GraphQL subscription upgrade request: ${req.url}`);
    commentGraphQLWsProxy.upgrade(req, socket, head);
    return;
  }
});

// Helper function to restream body for proxied requests
const restreamBody = (proxyReq, req) => {
  if (req.body) {
    const bodyData = JSON.stringify(req.body);
    proxyReq.setHeader("Content-Type", "application/json");
    proxyReq.setHeader("Content-Length", Buffer.byteLength(bodyData));
    proxyReq.write(bodyData);
    proxyReq.end();
  }
};

// Helper function to forward user headers
const forwardUserHeaders = (proxyReq, req) => {
  if (req.user) {
    proxyReq.setHeader("X-User-Id", req.user.userId);
    proxyReq.setHeader("X-User-Email", req.user.email);
  }
};

// Health check
app.get("/health", (req, res) => {
  res.json({
    success: true,
    service: "api-gateway",
    timestamp: new Date().toISOString(),
  });
});

// Circuit breaker health check
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

// Admin: Reset circuit breaker
app.post("/admin/circuit-breakers/:service/reset", (req, res) => {
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
});

// Auth routes (public) - parse body and restream
app.use(
  "/api/auth",
  bodyParser.json(),
  createCircuitBreakerProxy("auth", SERVICES.auth, {
    pathRewrite: { "^/api/auth": "/api" },
    onProxyReq: restreamBody,
  })
);

// Media routes (protected) - don't parse body (multipart/form-data)
app.use(
  "/api/media",
  authenticateToken,
  createCircuitBreakerProxy("media", SERVICES.media, {
    pathRewrite: { "^/api/media": "/api/media" },
    onProxyReq: forwardUserHeaders,
  })
);

// GraphQL HTTP proxy for Comment Service (NO WebSocket) with Circuit Breaker
const commentGraphQLHttpProxy = createCircuitBreakerProxy("comment", SERVICES.comment, {
  ws: false,  // Disable WebSocket for HTTP proxy
  logLevel: 'debug',
  onProxyReq: (proxyReq, req) => {
    logger.info(`[Proxy] HTTP → ${SERVICES.comment}${req.url}`);
    forwardUserHeaders(proxyReq, req);
    restreamBody(proxyReq, req);
  },
});

// GraphQL WebSocket proxy for Comment Service (ONLY WebSocket)
const commentGraphQLWsProxy = createProxyMiddleware({
  target: SERVICES.comment,
  changeOrigin: true,
  ws: true,  // Enable WebSocket
  logLevel: 'debug',
  onProxyReq: (proxyReq, req) => {
    logger.info(`[WebSocket-Init] Preparing upgrade → ${SERVICES.comment}${req.url}`);
    forwardUserHeaders(proxyReq, req);
  },
  onProxyReqWs: (proxyReq, req, socket) => {
    logger.info(`[WebSocket] ✅ Proxying upgrade to ${SERVICES.comment}`);
    logger.info(`[WebSocket] Target URL: ${SERVICES.comment}/graphql`);

    socket.on("error", (err) => {
      logger.error("[WebSocket] Socket error:", err.message);
    });

    socket.on("close", () => {
      logger.info("[WebSocket] Client disconnected");
    });
  },
  onError: (err, req, res) => {
    logger.error("[Proxy Error]", {
      message: err.message,
      code: err.code,
      target: SERVICES.comment,
    });
    if (!res.headersSent) {
      res.status(502).json({
        success: false,
        message: "Gateway proxy error",
      });
    }
  },
});

// GraphQL HTTP proxy for Post Service (NO WebSocket) with Circuit Breaker
const postGraphQLHttpProxy = createCircuitBreakerProxy("post", SERVICES.post, {
  ws: false,  // Disable WebSocket for HTTP proxy
  logLevel: 'debug',
  onProxyReq: (proxyReq, req) => {
    logger.info(`[Proxy] HTTP → ${SERVICES.post}${req.url}`);
    forwardUserHeaders(proxyReq, req);
    restreamBody(proxyReq, req);
  },
});

// GraphQL routes - dynamic routing with WebSocket support
app.use("/graphql", authenticateToken, (req, res, next) => {
  const isWebSocket = req.headers.upgrade?.toLowerCase() === 'websocket';
  if (isWebSocket) {
    return next();
  }
  bodyParser.json()(req, res, next);
}, (req, res, next) => {
  const query = req.body?.query || "";
  const operationName = req.body?.operationName || "";
  const isWebSocket = req.headers.upgrade?.toLowerCase() === 'websocket';
  if (isWebSocket) {
    return commentGraphQLWsProxy(req, res, next);
  }
  if (
    query.includes("subscription") ||
    query.includes("commentAdded") ||
    query.includes("commentDeleted") ||
    query.includes("commentUpdated") ||
    query.includes("getComments") ||
    query.includes("createComment") ||
    query.includes("deleteComment") ||
    operationName.toLowerCase().includes("comment")
  ) {
    return commentGraphQLHttpProxy(req, res, next);
  } else {
    return postGraphQLHttpProxy(req, res, next);
  }
});

// Root
app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "NewFeed API Gateway",
    version: "1.0.0",
    services: {
      auth: SERVICES.auth,
      post: SERVICES.post,
      media: SERVICES.media,
      comment: SERVICES.comment,
    },
  });
});

// 404
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "Route not found",
  });
});

// Error handler
app.use((err, req, res, next) => {
  logger.error("Gateway error:", err);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || "Internal server error",
  });
});

const PORT = process.env.PORT || 8080;
httpServer.listen(PORT, () => {
  logger.info(`🚀 API Gateway running on port ${PORT}`);
  logger.info(`🔗 HTTP: http://localhost:${PORT}`);
  logger.info(`🔗 WebSocket: ws://localhost:${PORT}`);
  logger.info(`📡 Services:`);
  logger.info(`   - Auth: ${SERVICES.auth}`);
  logger.info(`   - Post: ${SERVICES.post}`);
  logger.info(`   - Media: ${SERVICES.media}`);
  logger.info(`   - Comment: ${SERVICES.comment}`);
  logger.info(`🛡️  Redis-based rate limiting enabled`);
  logger.info(`📦 Response compression enabled`);
  logger.info(`⚡ Circuit breakers enabled for all services`);
  logger.info(`🔌 WebSocket proxy enabled for GraphQL subscriptions`);
});

// Graceful shutdown
process.on("SIGTERM", async () => {
  const { closeRedisConnection } = await import("./config/redis.js");
  await closeRedisConnection();
  process.exit(0);
});
