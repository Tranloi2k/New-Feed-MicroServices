import jwt from "jsonwebtoken";

// Verify JWT token and return decoded user or null
export function verifyToken(token) {
  try {
    return jwt.verify(token, process.env.JWT_SECRET);
  } catch (error) {
    return null;
  }
}

export function authenticateToken(req, res, next) {
  const token =
    req.cookies.access_token ||
    req.headers.authorization?.replace("Bearer ", "");

  if (!token) {
    return res.status(401).json({
      success: false,
      message: "Authentication required",
    });
  }

  const user = verifyToken(token);

  if (!user) {
    return res.status(403).json({
      success: false,
      message: "Invalid or expired token",
    });
  }

  req.user = user;
  next();
}
