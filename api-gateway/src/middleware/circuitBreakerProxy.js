import { createProxyMiddleware } from "http-proxy-middleware";
import { getServiceCircuitBreaker } from "./circuitBreaker.js";
import { createFallbackResponse } from "../config/circuitBreaker.js";
import { logger } from "../utils/logger.js";

/**
 * Create a proxy middleware with Circuit Breaker protection
 * 
 * This wrapper integrates Circuit Breaker into http-proxy-middleware flow:
 * - Checks circuit state before proxying
 * - Returns fallback response if circuit is OPEN
 * - Tracks requests through circuit breaker for statistics
 * 
 * @param {string} serviceName - Name of the service (for circuit breaker)
 * @param {string} serviceUrl - Base URL of the service
 * @param {Object} proxyOptions - Options for http-proxy-middleware
 * @returns {Function} Express middleware
 */
export function createCircuitBreakerProxy(serviceName, serviceUrl, proxyOptions = {}) {
  const breaker = getServiceCircuitBreaker(serviceName, serviceUrl);

  // Merge default proxy options with custom options
  const mergedOptions = {
    target: serviceUrl,
    changeOrigin: true,
    logLevel: 'info',
    ...proxyOptions,
    // Override onProxyReq to check circuit breaker
    onProxyReq: (proxyReq, req, res) => {
      // Check if circuit is OPEN before proxying
      if (breaker.opened) {
        logger.warn(`🚫 Circuit OPEN for ${serviceName}, rejecting request to ${req.url}`);
        proxyReq.destroy();

        // Return fallback response immediately
        if (!res.headersSent) {
          res.status(503).json(createFallbackResponse(serviceName));
        }
        return;
      }

      // Execute original onProxyReq if provided
      if (proxyOptions.onProxyReq) {
        proxyOptions.onProxyReq(proxyReq, req, res);
      }
    },
    // Override onError to handle circuit breaker errors
    onError: (err, req, res) => {
      logger.error(`[Circuit Breaker Proxy Error] ${serviceName}:`, {
        message: err.message,
        code: err.code,
        url: req.url,
      });

      // Track failure in circuit breaker by firing a minimal health check request
      // This allows circuit breaker to track failures and open circuit when threshold is reached
      // We use a minimal HEAD request to /health endpoint to minimize overhead
      // Only track if circuit is not already open (to avoid unnecessary requests)
      if (!breaker.opened) {
        // Fire health check to track failure (non-blocking)
        breaker.fire({
          method: 'HEAD',
          url: '/health',
          timeout: 500, // Quick timeout for health check (faster than proxy timeout)
        }).catch(() => {
          // Expected to fail - this is how we track the failure in circuit breaker
          // The circuit breaker will count this as a failure and may open the circuit
          logger.debug(`[Circuit Breaker] Tracked failure for ${serviceName}`);

          // After tracking, check if circuit opened
          // Note: This check happens in the catch handler, so circuit may have opened
          if (breaker.opened) {
            logger.warn(`🚫 Circuit OPEN for ${serviceName} after tracking failure`);
          }
        });
      }

      // Execute original onError if provided
      if (proxyOptions.onError) {
        proxyOptions.onError(err, req, res);
      } else {
        // Default error response
        if (!res.headersSent) {
          // If circuit is now open, return fallback
          if (breaker.opened) {
            return res.status(503).json(createFallbackResponse(serviceName));
          }

          res.status(502).json({
            success: false,
            message: `Gateway proxy error: ${serviceName} service unavailable`,
            error: err.code || "PROXY_ERROR",
          });
        }
      }
    },
    // Track successful responses through circuit breaker
    onProxyRes: (proxyRes, req, res) => {
      // Log successful responses for visibility
      if (proxyRes.statusCode >= 200 && proxyRes.statusCode < 300) {
        logger.debug(`✅ Proxy success: ${serviceName} ${req.method} ${req.url} - ${proxyRes.statusCode}`);

        // Track success in circuit breaker (only if circuit is half-open or we want to track)
        // This helps circuit breaker track success rate and close circuit if it was open
        // Only track occasionally to minimize overhead (every 10th request or if half-open)
        if (breaker.halfOpen || Math.random() < 0.1) {
          breaker.fire({
            method: 'HEAD',
            url: '/health',
            timeout: 500,
          }).then(() => {
            // Success tracked - circuit breaker will count this as success
            logger.debug(`[Circuit Breaker] Tracked success for ${serviceName}`);
          }).catch(() => {
            // Ignore - this shouldn't happen if service is healthy
          });
        }
      }

      // Execute original onProxyRes if provided
      if (proxyOptions.onProxyRes) {
        proxyOptions.onProxyRes(proxyRes, req, res);
      }
    },
  };

  // Create the proxy middleware
  const proxy = createProxyMiddleware(mergedOptions);

  // Wrap the proxy middleware to add circuit breaker check at Express level
  return async (req, res, next) => {
    // Skip circuit breaker check for WebSocket upgrade requests
    // WebSocket connections should not be blocked by circuit breaker
    const isWebSocket = req.headers.upgrade?.toLowerCase() === 'websocket';
    if (isWebSocket) {
      logger.debug(`[Circuit Breaker] Skipping circuit breaker check for WebSocket: ${serviceName}`);
      return proxy(req, res, next);
    }

    // Early check: If circuit is OPEN, return fallback immediately
    // This prevents even attempting to proxy
    const circuitState = breaker.opened ? 'OPEN' : breaker.halfOpen ? 'HALF_OPEN' : 'CLOSED';
    logger.debug(`[Circuit Breaker] ${serviceName} state: ${circuitState} for ${req.method} ${req.url}`);

    if (breaker.opened) {
      logger.warn(`🚫 Circuit OPEN for ${serviceName}, fast-fail for ${req.method} ${req.url}`);

      if (!res.headersSent) {
        return res.status(503).json(createFallbackResponse(serviceName));
      }
      return;
    }

    // Track request attempt in circuit breaker (for statistics)
    // This helps circuit breaker know a request is being made
    const requestStartTime = Date.now();

    // Wrap response handlers to track success/failure
    let responseHandled = false;
    const originalEnd = res.end;

    // Track when response is sent
    res.end = function (...args) {
      if (!responseHandled) {
        responseHandled = true;
        const duration = Date.now() - requestStartTime;

        // If response is successful, track success
        if (res.statusCode >= 200 && res.statusCode < 300) {
          // Track success occasionally
          if (breaker.halfOpen || Math.random() < 0.1) {
            breaker.fire({
              method: 'HEAD',
              url: '/health',
              timeout: 500,
            }).then(() => {
              logger.debug(`[Circuit Breaker] Tracked success for ${serviceName}`);
            }).catch(() => {
              // Ignore
            });
          }
        }
      }
      return originalEnd.apply(this, args);
    };

    // Circuit is CLOSED or HALF_OPEN, proceed with proxy
    // The proxy middleware will handle the actual request
    proxy(req, res, next);
  };
}

/**
 * Get circuit breaker instance for a service
 * Useful for checking status without creating proxy
 */
export function getCircuitBreakerForService(serviceName, serviceUrl) {
  return getServiceCircuitBreaker(serviceName, serviceUrl);
}

