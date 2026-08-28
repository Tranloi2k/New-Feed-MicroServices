import { logger } from "../utils/logger.js";

export function notFoundHandler(_req, res) {
  res.status(404).json({ success: false, message: "Route not found" });
}

export function errorHandler(error, _req, res, next) {
  logger.error("Gateway error:", error);
  if (res.headersSent) return next(error);

  return res.status(error.status || 500).json({
    success: false,
    message:
      process.env.NODE_ENV === "production"
        ? "Internal server error"
        : error.message || "Internal server error",
  });
}
