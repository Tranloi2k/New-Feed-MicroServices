import "dotenv/config";
import express from "express";
import cors from "cors";
import mediaRoutes from "./routes/mediaRoutes.js";
import { uploadErrorHandler } from "./middleware/errorHandler.js";

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

app.use(uploadErrorHandler);

const PORT = process.env.PORT;
app.listen(PORT, () => {
  console.log(`🖼️  Media Service running on port ${PORT}`);
});
