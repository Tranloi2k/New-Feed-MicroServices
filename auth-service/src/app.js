import "dotenv/config";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import authRoutes from "./routes/authRoutes.js";
import { createRedisClient } from "./config/redis.js";

const app = express();

// Initialize Redis for caching
createRedisClient();

// Middleware
app.use(
  cors({
    origin: process.env.CLIENT_URL || "http://localhost:3000",
    credentials: true,
  })
);
app.use(express.json());
app.use(cookieParser());

// Routes
app.use("/api", authRoutes);

// Health check
app.get("/health", (req, res) => {
  res.json({
    success: true,
    service: "auth-service",
    timestamp: new Date().toISOString(),
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error("Auth service error:", err);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || "Internal server error",
  });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🔐 Auth Service running on port ${PORT}`);
});
