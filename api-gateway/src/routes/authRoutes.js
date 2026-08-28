import express from "express";
import { authenticateToken } from "../middleware/auth.js";

const PUBLIC_AUTH_ACTIONS = ["login", "signup", "logout", "validate-token"];

export function createAuthRoutes({ proxies, jsonParser }) {
  const router = express.Router();

  router.get("/api/auth/me", authenticateToken, proxies.authMe);
  for (const action of PUBLIC_AUTH_ACTIONS) {
    router.post(`/api/auth/${action}`, jsonParser, proxies.publicAuth);
  }

  return router;
}
