import { checkUserRateLimit } from "../services/rateLimitService.js";

export async function allowSocketEvent(socket, event, rules) {
  const result = await checkUserRateLimit({
    userId: socket.data.userId,
    action: `socket:${event}`,
    rules,
  });

  if (result.allowed) return result;

  socket.emit("rate_limit:error", {
    event,
    retryAfter: result.retryAfter,
  });
  return result;
}
