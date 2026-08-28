import { logger } from "./logger.js";

const INTERNAL_IDENTITY_HEADERS = [
  "x-user-id",
  "x-user-email",
  "x-service-token",
];

export function stripUntrustedIdentityHeaders(req, _res, next) {
  for (const header of INTERNAL_IDENTITY_HEADERS) {
    delete req.headers[header];
  }
  next();
}

export function restreamBody(proxyReq, req) {
  if (req.body === undefined || req.body === null) return;

  const bodyData = JSON.stringify(req.body);
  proxyReq.removeHeader("content-encoding");
  proxyReq.removeHeader("transfer-encoding");
  proxyReq.setHeader("Content-Type", "application/json");
  proxyReq.setHeader("Content-Length", Buffer.byteLength(bodyData));
  proxyReq.write(bodyData);
}

export function forwardUserHeaders(proxyReq, req) {
  for (const header of INTERNAL_IDENTITY_HEADERS) {
    proxyReq.removeHeader(header);
  }

  proxyReq.setHeader("X-Service-Token", process.env.SERVICE_SECRET);

  if (req.user) {
    proxyReq.setHeader("X-User-Id", req.user.userId);
    if (req.user.email) {
      proxyReq.setHeader("X-User-Email", req.user.email);
    }
  }
}

export function attachWsSocketLogging(socket, label) {
  socket.on("error", (err) => {
    logger.error(`[${label}] Socket error:`, err.message);
  });
  socket.on("close", () => {
    logger.debug(`[${label}] Client disconnected`);
  });
}

export function handleProxyError(err, req, res, { target, message }) {
  logger.error(message, {
    message: err.message,
    code: err.code,
    target,
    url: req.url,
  });
  if (res && typeof res.status === "function" && !res.headersSent) {
    res.status(502).json({
      success: false,
      message,
    });
    return;
  }
  if (res && typeof res.destroy === "function") {
    res.destroy();
  }
}
