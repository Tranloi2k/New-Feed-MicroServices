import express from "express";
import {
  signup,
  login,
  logout,
  refresh,
  getCurrentUser,
  getUserById,
} from "../controllers/authController.js";
import { requireUser } from "../middleware/requireUser.js";
import { requireServiceAuth } from "../middleware/serviceAuth.js";

const router = express.Router();

// Public routes
router.post("/signup", signup);
router.post("/login", login);
router.post("/logout", logout);
router.post("/refresh", refresh);
// Protected routes (called from API Gateway with user info in headers)
router.get("/me", requireUser, getCurrentUser);

// Internal routes (service-to-service)
router.get("/internal/users/:id", requireServiceAuth, getUserById);

export default router;
