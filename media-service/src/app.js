import "dotenv/config";
import express from "express";
import cors from "cors";
import mediaRoutes from "./routes/mediaRoutes.js";

const app = express();

// Middleware
app.use(
  cors({
    origin: process.env.CLIENT_URL,
    credentials: true,
  })
);
app.use(express.json());

// Routes
app.use("/api/media", mediaRoutes);

// Health check
app.get("/health", (req, res) => {
  res.json({
    success: true,
    service: "media-service",
    timestamp: new Date().toISOString(),
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error("Media service error:", err);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || "Internal server error",
  });
});

const PORT = process.env.PORT;
app.listen(PORT, () => {
  console.log(`🖼️  Media Service running on port ${PORT}`);
});
