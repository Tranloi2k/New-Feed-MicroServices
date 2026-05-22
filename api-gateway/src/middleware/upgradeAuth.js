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

function extractTokenFromUrl(url = "") {
  try {
    const search = url.includes("?") ? url.slice(url.indexOf("?")) : "";
    const params = new URLSearchParams(search);
    return (
      params.get("access_token") ||
      params.get("token") ||
      params.get("Authorization")?.replace(/^Bearer\s+/i, "")
    );
  } catch {
    return null;
  }
}

/**
 * Authenticate raw HTTP upgrade requests (WebSocket).
 * Sets req.user when valid; returns false and destroys socket when invalid.
 */
export function authenticateUpgrade(req, socket) {
  const cookies = parseCookies(req.headers.cookie);
  const token =
    cookies.access_token ||
    req.headers.authorization?.replace(/^Bearer\s+/i, "") ||
    extractTokenFromUrl(req.url);

  if (!token) {
    logger.warn(`[WS Auth] Rejected upgrade: missing token (${req.url})`);
    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
    socket.destroy();
    return false;
  }

  const user = verifyToken(token);
  if (!user) {
    logger.warn(`[WS Auth] Rejected upgrade: invalid token (${req.url})`);
    socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
    socket.destroy();
    return false;
  }

  req.user = user;
  return true;
}
