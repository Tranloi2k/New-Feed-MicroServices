import jwt from "jsonwebtoken";

export function extractAccessToken(req) {
  const cookieToken = req.cookies?.access_token;
  if (cookieToken) return cookieToken;
  const match = req.headers.authorization?.match(/^Bearer\s+([^\s]+)$/i);
  return match?.[1] || null;
}

export function verifyAccessToken(token) {
  if (!token || !process.env.JWT_SECRET) return null;
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET, {
      algorithms: ["HS256"],
      ...(process.env.JWT_ISSUER && { issuer: process.env.JWT_ISSUER }),
      ...(process.env.JWT_AUDIENCE && { audience: process.env.JWT_AUDIENCE }),
    });
    const userId = Number(payload.userId);
    return Number.isSafeInteger(userId) && userId > 0 ? { ...payload, userId } : null;
  } catch {
    return null;
  }
}

export function authenticate(req, res, next) {
  const user = verifyAccessToken(extractAccessToken(req));
  if (!user) {
    return res.status(401).json({ success: false, message: "Authentication required" });
  }
  req.user = user;
  next();
}
