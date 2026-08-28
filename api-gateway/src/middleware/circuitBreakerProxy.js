import { createProxyMiddleware } from "http-proxy-middleware";
import {
  createFallbackResponse,
  getCircuitBreakerOptions,
} from "../config/circuitBreaker.js";
import { getServiceCircuitBreaker } from "./circuitBreaker.js";
import { logger } from "../utils/logger.js";

const CIRCUIT_REQUEST = Symbol("circuitRequest");

function settleRequest(req, breaker, failed, error) {
  const requestState = req[CIRCUIT_REQUEST];
  if (!requestState || requestState.settled) return;

  requestState.settled = true;
  const durationMs = Date.now() - requestState.startedAt;

  if (failed) {
    const timeout = ["ETIMEDOUT", "ESOCKETTIMEDOUT"].includes(error?.code);
    breaker.recordFailure({ durationMs, timeout, probe: requestState.probe });
  } else {
    breaker.recordSuccess(durationMs, { probe: requestState.probe });
  }
}

export function createCircuitBreakerProxy(
  serviceName,
  serviceUrl,
  proxyOptions = {}
) {
  const breaker = getServiceCircuitBreaker(serviceName);
  const { timeout } = getCircuitBreakerOptions(serviceName);

  const proxy = createProxyMiddleware({
    target: serviceUrl,
    changeOrigin: true,
    proxyTimeout: timeout,
    timeout: timeout + 1_000,
    logLevel: "info",
    ...proxyOptions,
    onProxyReq: (proxyReq, req, res) => {
      proxyOptions.onProxyReq?.(proxyReq, req, res);
    },
    onProxyRes: (proxyRes, req, res) => {
      settleRequest(req, breaker, proxyRes.statusCode >= 500);
      proxyOptions.onProxyRes?.(proxyRes, req, res);
    },
    onError: (error, req, res) => {
      settleRequest(req, breaker, true, error);
      logger.error(`Proxy error for ${serviceName}`, {
        code: error.code,
        message: error.message,
        method: req.method,
        path: req.url,
      });

      if (proxyOptions.onError) {
        proxyOptions.onError(error, req, res);
        return;
      }

      if (res && typeof res.status === "function" && !res.headersSent) {
        res.status(502).json({
          success: false,
          error: "BAD_GATEWAY",
          message: `${serviceName} service is unavailable`,
        });
      } else if (res && typeof res.destroy === "function") {
        res.destroy();
      }
    },
  });

  return (req, res, next) => {
    if (!breaker.tryAcquire()) {
      logger.warn(`Circuit rejected ${req.method} ${req.url}`, { serviceName });
      return res.status(503).json(createFallbackResponse(serviceName));
    }

    req[CIRCUIT_REQUEST] = {
      startedAt: Date.now(),
      settled: false,
      probe: breaker.state === "HALF_OPEN",
    };
    return proxy(req, res, next);
  };
}

export function getCircuitBreakerForService(serviceName) {
  return getServiceCircuitBreaker(serviceName);
}
