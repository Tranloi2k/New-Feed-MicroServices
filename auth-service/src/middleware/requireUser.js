export function requireUser(req, res, next) {
  const userIdHeader = req.headers["x-user-id"];
  if (!userIdHeader) {
    return res.status(401).json({
      success: false,
      message: "Authentication required",
    });
  }

  const userId = parseInt(userIdHeader, 10);
  if (Number.isNaN(userId)) {
    return res.status(401).json({
      success: false,
      message: "Invalid user identity",
    });
  }

  req.user = {
    userId,
    email: req.headers["x-user-email"],
  };
  next();
}

export function optionalViewer(req, res, next) {
  const userIdHeader = req.headers["x-user-id"];
  if (userIdHeader) {
    const userId = parseInt(userIdHeader, 10);
    if (!Number.isNaN(userId)) {
      req.viewerId = userId;
    }
  }
  next();
}
