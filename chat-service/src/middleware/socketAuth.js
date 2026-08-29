import { verifyAccessToken } from "./auth.js";

function parseCookies(header = "") {
  return header.split(";").reduce((result, part) => {
    const [name, ...value] = part.trim().split("=");
    if (name) result[name] = decodeURIComponent(value.join("="));
    return result;
  }, {});
}

export function extractSocketToken(handshake) {
  const cookies = parseCookies(handshake.headers?.cookie || "");
  if (cookies.access_token) return cookies.access_token;
  if (handshake.auth?.token) return handshake.auth.token;
  const match = handshake.headers?.authorization?.match(/^Bearer\s+([^\s]+)$/i);
  return match?.[1] || null;
}

export function socketAuth(socket, next) {
  const user = verifyAccessToken(extractSocketToken(socket.handshake));
  if (!user) return next(new Error("Authentication required"));
  socket.data.userId = user.userId;
  socket.data.userEmail = user.email;
  next();
}
