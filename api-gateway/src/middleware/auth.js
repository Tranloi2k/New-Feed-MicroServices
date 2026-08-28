import jwt from "jsonwebtoken";

export function extractAccessToken(req) {
  const cookieToken = req.cookies?.access_token;
  if (cookieToken) return cookieToken;

  const match = req.headers.authorization?.match(/^Bearer\s+([^\s]+)$/i);
  return match?.[1] || null;
}

export function verifyToken(token) {
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET, {
      algorithms: ["HS256"],
    });
    const userId = Number(payload.userId);
    if (!Number.isSafeInteger(userId) || userId <= 0) return null;
    return { ...payload, userId };
  } catch {
    return null;
  }
}

export function authenticateToken(req, res, next) {
  const token = extractAccessToken(req);

  if (!token) {
    return res.status(401).json({
      success: false,
      message: "Authentication required",
    });
  }

  const user = verifyToken(token);

  if (!user) {
    return res.status(401).json({
      success: false,
      message: "Invalid or expired token",
    });
  }

  req.user = user;
  next();
}

/** Sets req.user when token is valid; does not block unauthenticated requests */
export function optionalAuthenticateToken(req, res, next) {
  const token = extractAccessToken(req);

  if (token) {
    const user = verifyToken(token);
    if (user) {
      req.user = user;
    }
  }
  next();
}
