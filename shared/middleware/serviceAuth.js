// Service-to-service authentication middleware
export function authenticateService(req, res, next) {
  const serviceToken = req.headers["x-service-token"];

  if (!serviceToken || serviceToken !== process.env.SERVICE_SECRET) {
    return res.status(403).json({
      success: false,
      message: "Unauthorized service call",
    });
  }

  next();
}

// Extract user from JWT (for internal calls)
export async function extractUserFromToken(token, jwtSecret) {
  try {
    const jwt = await import("jsonwebtoken");
    return jwt.default.verify(token, jwtSecret);
  } catch (error) {
    return null;
  }
}
