import { getTrustedIdentity } from "./trustedIdentity.js";

export function requireUser(req, res, next) {
  const user = getTrustedIdentity(req.headers);
  if (!user) {
    return res.status(401).json({
      success: false,
      message: "Authentication required",
    });
  }

  req.user = user;
  next();
}

export function optionalViewer(req, res, next) {
  const user = getTrustedIdentity(req.headers);
  if (user) {
    req.viewerId = user.userId;
  }
  next();
}
