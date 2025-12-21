import CircuitBreaker from "opossum";
import { logger } from "../utils/logger.js";

/**
 * Circuit Breaker Configuration
 * 
 * Protects downstream services from cascading failures
 * Using Opossum library for circuit breaker pattern
 * 
 * States:
 * - CLOSED: Normal operation, requests pass through
 * - OPEN: Service is failing, requests immediately fail
 * - HALF_OPEN: Testing if service recovered
 */

const circuitBreakerOptions = {
    timeout: 10000, // 10 seconds - request timeout
    errorThresholdPercentage: 30, // Open circuit if 30% of requests fail (lower = faster opening)
    resetTimeout: 30000, // 30 seconds - try again after this time
    rollingCountTimeout: 10000, // 10 seconds - statistical window
    rollingCountBuckets: 10, // Number of buckets in the window
    name: "microservice-circuit-breaker",
    volumeThreshold: 1, // Minimum number of requests before checking error percentage (reduced for faster circuit opening)
};

/**
 * Create circuit breaker for HTTP requests
 * @param {Function} requestFunction - Async function that makes the HTTP request
 * @param {string} serviceName - Name of the service for logging
 * @returns {CircuitBreaker} Circuit breaker instance
 */
export function createCircuitBreaker(requestFunction, serviceName) {
    const breaker = new CircuitBreaker(requestFunction, {
        ...circuitBreakerOptions,
        name: `${serviceName}-breaker`,
    });

    // Event: Circuit opened (service is down)
    breaker.on("open", () => {
        logger.error(`🔴 Circuit OPEN for ${serviceName} - service is failing`);
    });

    // Event: Circuit closed (service recovered)
    breaker.on("close", () => {
        logger.info(`🟢 Circuit CLOSED for ${serviceName} - service recovered`);
    });

    // Event: Circuit half-open (testing recovery)
    breaker.on("halfOpen", () => {
        logger.warn(`🟡 Circuit HALF-OPEN for ${serviceName} - testing recovery`);
    });

    // Event: Request succeeded
    breaker.on("success", (result) => {
        logger.debug(`✅ Request to ${serviceName} succeeded`);
    });

    // Event: Request failed
    breaker.on("failure", (error) => {
        logger.warn(`❌ Request to ${serviceName} failed:`, error.message);
    });

    // Event: Request timeout
    breaker.on("timeout", () => {
        logger.error(`⏱️  Request to ${serviceName} timed out`);
    });

    // Event: Circuit breaker rejected request (circuit is open)
    breaker.on("reject", () => {
        logger.warn(`🚫 Request to ${serviceName} rejected - circuit is OPEN`);
    });

    // Event: Fallback executed
    breaker.on("fallback", (result) => {
        logger.info(`🔄 Fallback executed for ${serviceName}`);
    });

    return breaker;
}

/**
 * Create fallback response for when service is unavailable
 * @param {string} serviceName - Name of the service
 * @returns {Object} Fallback response
 */
export function createFallbackResponse(serviceName) {
    return {
        success: false,
        error: "SERVICE_UNAVAILABLE",
        message: `${serviceName} is temporarily unavailable. Please try again later.`,
        service: serviceName,
        timestamp: new Date().toISOString(),
    };
}

/**
 * Get circuit breaker health status
 * @param {CircuitBreaker} breaker - Circuit breaker instance
 * @returns {Object} Health status
 */
export function getCircuitBreakerStatus(breaker) {
    const stats = breaker.stats;

    return {
        name: breaker.name,
        state: breaker.opened ? "OPEN" : breaker.halfOpen ? "HALF_OPEN" : "CLOSED",
        stats: {
            fires: stats.fires, // Total requests
            successes: stats.successes,
            failures: stats.failures,
            timeouts: stats.timeouts,
            rejects: stats.rejects,
            fallbacks: stats.fallbacks,
            latencyMean: stats.latencyMean,
            percentiles: stats.percentiles,
        },
    };
}

/**
 * Service-specific circuit breaker configurations
 */
export const serviceCircuitBreakerOptions = {
    auth: {
        timeout: 5000, // Auth should be fast
        errorThresholdPercentage: 50,
        resetTimeout: 20000,
    },
    post: {
        timeout: 10000,
        errorThresholdPercentage: 50,
        resetTimeout: 30000,
    },
    comment: {
        timeout: 10000,
        errorThresholdPercentage: 50,
        resetTimeout: 30000,
    },
    media: {
        timeout: 30000, // Media uploads can take longer
        errorThresholdPercentage: 60,
        resetTimeout: 45000,
    },
};
