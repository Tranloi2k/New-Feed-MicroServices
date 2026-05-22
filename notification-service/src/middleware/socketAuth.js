import jwt from "jsonwebtoken";

function parseCookies(cookieHeader = "") {
  return cookieHeader.split(";").reduce((cookies, part) => {
    const [name, ...rest] = part.trim().split("=");
    if (!name) return cookies;
    cookies[name] = decodeURIComponent(rest.join("="));
    return cookies;
  }, {});
}

export function extractTokenFromHandshake(handshake) {
  const auth = handshake.auth || {};
  if (auth.token) return auth.token;
  if (auth.accessToken) return auth.accessToken;

  const cookies = parseCookies(handshake.headers?.cookie || "");
  if (cookies.access_token) return cookies.access_token;

  const authHeader = handshake.headers?.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice(7);
  }

  return null;
}

export function verifySocketToken(token) {
  if (!token || !process.env.JWT_SECRET) return null;
  try {
    return jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return null;
  }
}

export function socketAuthMiddleware(socket, next) {
  const token = extractTokenFromHandshake(socket.handshake);
  const user = verifySocketToken(token);

  if (!user?.userId) {
    return next(new Error("Authentication required"));
  }

  socket.data.userId = user.userId;
  socket.data.userEmail = user.email;
  next();
}
