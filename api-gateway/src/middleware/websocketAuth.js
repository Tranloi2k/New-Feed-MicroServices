import { verifyToken } from "./auth.js";
import { logger } from "../utils/logger.js";

function parseCookies(cookieHeader = "") {
  return cookieHeader.split(";").reduce((cookies, part) => {
    const [name, ...rest] = part.trim().split("=");
    if (!name) return cookies;
    cookies[name] = decodeURIComponent(rest.join("="));
    return cookies;
  }, {});
}

function redactUrl(url = "") {
  try {
    const parsed = new URL(url, "http://gateway.local");
    for (const key of ["access_token", "token", "Authorization"]) {
      if (parsed.searchParams.has(key)) parsed.searchParams.set(key, "[REDACTED]");
    }
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return "[invalid-url]";
  }
}

/** Authenticate a WebSocket HTTP Upgrade request before it is proxied. */
export function authenticateWebSocketUpgrade(req, socket) {
  const cookies = parseCookies(req.headers.cookie);
  const token =
    cookies.access_token ||
    req.headers.authorization?.replace(/^Bearer\s+/i, "");

  if (!token) {
    logger.warn(`[WS Auth] Rejected upgrade: missing token (${redactUrl(req.url)})`);
    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
    socket.destroy();
    return false;
  }

  const user = verifyToken(token);
  if (!user) {
    logger.warn(`[WS Auth] Rejected upgrade: invalid token (${redactUrl(req.url)})`);
    socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
    socket.destroy();
    return false;
  }

  req.user = user;
  return true;
}
