import { timingSafeEqual } from "node:crypto";

export function requireServiceAuth(req, res, next) {
  const presented = req.headers["x-service-token"];
  const expected = process.env.SERVICE_SECRET;
  if (
    typeof presented !== "string" ||
    typeof expected !== "string" ||
    !presented ||
    !expected
  ) {
    return res.status(403).json({ success: false, message: "Unauthorized service call" });
  }

  const presentedBuffer = Buffer.from(presented);
  const expectedBuffer = Buffer.from(expected);
  if (
    presentedBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(presentedBuffer, expectedBuffer)
  ) {
    return res.status(403).json({ success: false, message: "Unauthorized service call" });
  }
  return next();
}
