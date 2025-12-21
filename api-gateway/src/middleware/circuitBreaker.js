import axios from "axios";
import {
    createCircuitBreaker,
    createFallbackResponse,
    serviceCircuitBreakerOptions,
} from "../config/circuitBreaker.js";
import { logger } from "../utils/logger.js";

// Circuit Breakers for each microservice
// Shared across all requests to the same service
const circuitBreakers = {};

/**
 * Get or create circuit breaker for a service
 * @param {string} serviceName - Name of the service
 * @param {string} serviceUrl - Base URL of the service
 * @returns {CircuitBreaker} Circuit breaker instance
 */
export function getServiceCircuitBreaker(serviceName, serviceUrl) {
    if (circuitBreakers[serviceName]) {
        return circuitBreakers[serviceName];
    }

    // Create request function for this service
    const requestFunction = async (options) => {
        const response = await axios({
            baseURL: serviceUrl,
            ...options,
            // Disable axios timeout, let circuit breaker handle it
            timeout: 0,
        });
        return response;
    };

    // Get service-specific options or use defaults
    const options = serviceCircuitBreakerOptions[serviceName] || {};

    // Create circuit breaker
    const breaker = createCircuitBreaker(requestFunction, serviceName);

    // Apply service-specific options
    if (options.timeout) breaker.options.timeout = options.timeout;
    if (options.errorThresholdPercentage)
        breaker.options.errorThresholdPercentage = options.errorThresholdPercentage;
    if (options.resetTimeout) breaker.options.resetTimeout = options.resetTimeout;

    // Set fallback
    breaker.fallback(() => createFallbackResponse(serviceName));

    // Cache the breaker
    circuitBreakers[serviceName] = breaker;

    return breaker;
}

/**
 * Circuit breaker middleware for proxying requests
 * Wraps the proxy request in a circuit breaker
 * @param {string} serviceName - Name of the service
 * @param {string} serviceUrl - Base URL of the service
 */
export function createCircuitBreakerMiddleware(serviceName, serviceUrl) {
    return async (req, res, next) => {
        const breaker = getServiceCircuitBreaker(serviceName, serviceUrl);

        // Store breaker in request for proxy to use
        req.circuitBreaker = breaker;
        req.serviceName = serviceName;

        next();
    };
}

/**
 * Execute request through circuit breaker
 * @param {CircuitBreaker} breaker - Circuit breaker instance
 * @param {Object} options - Axios request options
 * @returns {Promise<Object>} Response data
 */
export async function executeWithCircuitBreaker(breaker, options) {
    try {
        const response = await breaker.fire(options);
        return response;
    } catch (error) {
        // Circuit breaker will have already logged the error
        throw error;
    }
}

/**
 * Get all circuit breaker statuses
 * Useful for health check endpoint
 */
export function getAllCircuitBreakerStatuses() {
    const statuses = {};

    for (const [serviceName, breaker] of Object.entries(circuitBreakers)) {
        const stats = breaker.stats;
        statuses[serviceName] = {
            state: breaker.opened ? "OPEN" : breaker.halfOpen ? "HALF_OPEN" : "CLOSED",
            healthy: !breaker.opened,
            stats: {
                fires: stats.fires,
                successes: stats.successes,
                failures: stats.failures,
                timeouts: stats.timeouts,
                rejects: stats.rejects,
                successRate:
                    stats.fires > 0
                        ? ((stats.successes / stats.fires) * 100).toFixed(2) + "%"
                        : "N/A",
                avgLatency: stats.latencyMean
                    ? stats.latencyMean.toFixed(2) + "ms"
                    : "N/A",
            },
        };
    }

    return statuses;
}

/**
 * Reset circuit breaker for a service
 * Useful for admin operations
 */
export function resetCircuitBreaker(serviceName) {
    const breaker = circuitBreakers[serviceName];
    if (breaker) {
        breaker.close();
        logger.info(`Circuit breaker reset for ${serviceName}`);
        return true;
    }
    return false;
}

/**
 * Reset all circuit breakers
 */
export function resetAllCircuitBreakers() {
    for (const [serviceName, breaker] of Object.entries(circuitBreakers)) {
        breaker.close();
        logger.info(`Circuit breaker reset for ${serviceName}`);
    }
}
