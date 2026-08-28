import { timingSafeEqual } from "node:crypto";

export function isServiceTokenValid(
  presentedToken,
  expectedToken = process.env.SERVICE_SECRET
) {
  if (
    typeof presentedToken !== "string" ||
    typeof expectedToken !== "string" ||
    !presentedToken ||
    !expectedToken
  ) {
    return false;
  }

  const presented = Buffer.from(presentedToken);
  const expected = Buffer.from(expectedToken);
  return (
    presented.length === expected.length && timingSafeEqual(presented, expected)
  );
}

export function requireServiceAuth(req, res, next) {
  if (!isServiceTokenValid(req.headers["x-service-token"])) {
    return res.status(403).json({
      success: false,
      message: "Unauthorized service call",
    });
  }

  return next();
}
