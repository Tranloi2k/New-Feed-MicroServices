import express from "express";
import {
  authenticateToken,
  optionalAuthenticateToken,
} from "../middleware/auth.js";

export function createUserRoutes({ proxy, jsonParser }) {
  const router = express.Router();

  router.get(
    "/api/users/username/:username",
    optionalAuthenticateToken,
    proxy
  );
  router.get(
    "/api/users/:id/profile",
    optionalAuthenticateToken,
    proxy
  );
  router.get(
    "/api/users/:id/followers",
    optionalAuthenticateToken,
    proxy
  );
  router.get(
    "/api/users/:id/following",
    optionalAuthenticateToken,
    proxy
  );
  router.patch(
    "/api/users/me/profile",
    authenticateToken,
    jsonParser,
    proxy
  );
  router.post("/api/users/:id/follow", authenticateToken, proxy);
  router.delete("/api/users/:id/follow", authenticateToken, proxy);

  return router;
}
