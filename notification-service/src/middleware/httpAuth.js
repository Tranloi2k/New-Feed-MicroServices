import jwt from "jsonwebtoken";
import { getTrustedIdentity } from "./trustedIdentity.js";

export function requireUser(req, res, next) {
  const trustedIdentity = getTrustedIdentity(req.headers);
  if (trustedIdentity) {
    req.user = trustedIdentity;
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
