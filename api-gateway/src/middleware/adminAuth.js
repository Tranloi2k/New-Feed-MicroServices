/**
 * Protect admin routes with SERVICE_SECRET header.
 */
export function requireServiceSecret(req, res, next) {
  const secret = req.headers["x-service-secret"];
  const expected = process.env.SERVICE_SECRET;

  if (!expected) {
    return res.status(503).json({
      success: false,
      message: "Admin routes are not configured (SERVICE_SECRET missing)",
    });
  }

  if (!secret || secret !== expected) {
    return res.status(403).json({
      success: false,
      message: "Forbidden",
    });
  }

  next();
}
