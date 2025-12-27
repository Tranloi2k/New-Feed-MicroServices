import express from "express";
import {
  signup,
  login,
  logout,
  getCurrentUser,
  getUserById,
  validateToken
} from "../controllers/authController.js";

const router = express.Router();

// Public routes
router.post("/signup", signup);
router.post("/login", login);
router.post("/logout", logout);
router.post("/validate-token", validateToken)

// Protected routes (called from API Gateway with user info in headers)
router.get("/me", getCurrentUser);

// Internal routes (service-to-service)
router.get("/internal/users/:id", getUserById);

export default router;
