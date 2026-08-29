import { checkUserRateLimit } from "../services/rateLimitService.js";

export function userRateLimit(
  action,
  rules,
  { check = checkUserRateLimit } = {}
) {
  return async (req, res, next) => {
    const result = await check({
      userId: req.user.userId,
      action: `rest:${action}`,
      rules,
    });

    if (result.remaining >= 0) {
      res.set("X-RateLimit-Remaining", String(result.remaining));
    }
    if (result.allowed) return next();

    res.set("Retry-After", String(result.retryAfter));
    return res.status(429).json({
      success: false,
      error: "RATE_LIMIT_EXCEEDED",
      message: "Quá nhiều yêu cầu chat. Vui lòng thử lại sau.",
      retryAfter: result.retryAfter,
    });
  };
}
