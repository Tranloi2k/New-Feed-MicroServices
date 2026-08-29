import express from "express";
import { requireServiceSecret } from "../middleware/adminAuth.js";
import {
  getAllCircuitBreakerStatuses,
  resetCircuitBreaker,
} from "../middleware/circuitBreaker.js";

export function createSystemRoutes() {
  const router = express.Router();

  router.get("/health", (_req, res) => {
    res.json({
      success: true,
      service: "api-gateway",
      timestamp: new Date().toISOString(),
    });
  });

  router.get("/health/circuit-breakers", (_req, res) => {
    const statuses = getAllCircuitBreakerStatuses();
    const allHealthy = Object.values(statuses).every((status) => status.healthy);
    res.status(allHealthy ? 200 : 503).json({
      success: allHealthy,
      service: "api-gateway",
      circuitBreakers: statuses,
      timestamp: new Date().toISOString(),
    });
  });

  router.post(
    "/admin/circuit-breakers/:service/reset",
    requireServiceSecret,
    (req, res) => {
      const reset = resetCircuitBreaker(req.params.service);
      if (!reset) {
        return res.status(404).json({
          success: false,
          message: `Circuit breaker not found for ${req.params.service}`,
        });
      }
      return res.json({
        success: true,
        message: `Circuit breaker reset for ${req.params.service}`,
      });
    }
  );

  router.get("/", (_req, res) => {
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
        chatWs: "/chat/socket.io",
      },
    });
  });

  return router;
}
