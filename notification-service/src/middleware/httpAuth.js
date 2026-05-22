import jwt from "jsonwebtoken";

export function requireUser(req, res, next) {
  const userIdHeader = req.headers["x-user-id"];
  const userEmail = req.headers["x-user-email"];

  if (userIdHeader) {
    req.user = {
      userId: parseInt(userIdHeader, 10),
      email: userEmail,
    };
    return next();
  }

  const token =
    req.cookies?.access_token ||
    req.headers.authorization?.replace(/^Bearer\s+/i, "");

  if (!token) {
    return res.status(401).json({
      success: false,
      message: "Authentication required",
    });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = {
      userId: decoded.userId,
      email: decoded.email,
    };
    return next();
  } catch {
    return res.status(403).json({
      success: false,
      message: "Invalid or expired token",
    });
  }
}
