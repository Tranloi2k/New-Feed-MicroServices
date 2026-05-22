import { logger } from "./logger.js";

export function restreamBody(proxyReq, req) {
  if (req.body) {
    const bodyData = JSON.stringify(req.body);
    proxyReq.setHeader("Content-Type", "application/json");
    proxyReq.setHeader("Content-Length", Buffer.byteLength(bodyData));
    proxyReq.write(bodyData);
    proxyReq.end();
  }
}

export function forwardUserHeaders(proxyReq, req) {
  if (req.user) {
    proxyReq.setHeader("X-User-Id", req.user.userId);
    proxyReq.setHeader("X-User-Email", req.user.email);
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
  }
  if (res && typeof res.destroy === "function") {
    res.destroy();
  }
}
