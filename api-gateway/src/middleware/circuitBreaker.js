import { getCircuitBreakerOptions } from "../config/circuitBreaker.js";
import { logger } from "../utils/logger.js";

const circuitBreakers = new Map();

export class ProxyCircuitBreaker {
  constructor(serviceName, options = {}, now = () => Date.now()) {
    this.serviceName = serviceName;
    this.options = { ...getCircuitBreakerOptions(serviceName), ...options };
    this.now = now;
    this.state = "CLOSED";
    this.openedAt = null;
    this.halfOpenRequestInFlight = false;
    this.outcomes = [];
    this.stats = {
      fires: 0,
      successes: 0,
      failures: 0,
      timeouts: 0,
      rejects: 0,
      latencyTotal: 0,
    };
  }

  tryAcquire() {
    const now = this.now();

    if (
      this.state === "OPEN" &&
      now - this.openedAt >= this.options.resetTimeout
    ) {
      this.state = "HALF_OPEN";
      this.halfOpenRequestInFlight = false;
      logger.warn(`Circuit HALF_OPEN for ${this.serviceName}`);
    }

    if (this.state === "OPEN") {
      this.stats.rejects += 1;
      return false;
    }

    if (this.state === "HALF_OPEN") {
      if (this.halfOpenRequestInFlight) {
        this.stats.rejects += 1;
        return false;
      }
      this.halfOpenRequestInFlight = true;
    }

    this.stats.fires += 1;
    return true;
  }

  recordSuccess(durationMs = 0, { probe = false } = {}) {
    this.stats.successes += 1;
    this.stats.latencyTotal += durationMs;

    if (probe && this.state === "HALF_OPEN") {
      this.reset();
      logger.info(`Circuit CLOSED for ${this.serviceName}`);
      return;
    }

    if (this.state === "CLOSED") this.#recordOutcome(false);
  }

  recordFailure({ durationMs = 0, timeout = false, probe = false } = {}) {
    this.stats.failures += 1;
    this.stats.latencyTotal += durationMs;
    if (timeout) this.stats.timeouts += 1;

    if (probe && this.state === "HALF_OPEN") {
      this.#open();
      return;
    }

    if (this.state !== "CLOSED") return;

    this.#recordOutcome(true);
    const failures = this.outcomes.filter((outcome) => outcome.failed).length;
    const failureRate = (failures / this.outcomes.length) * 100;

    if (
      this.outcomes.length >= this.options.volumeThreshold &&
      failureRate >= this.options.errorThresholdPercentage
    ) {
      this.#open();
    }
  }

  reset() {
    this.state = "CLOSED";
    this.openedAt = null;
    this.halfOpenRequestInFlight = false;
    this.outcomes = [];
  }

  getStatus() {
    const completed = this.stats.successes + this.stats.failures;
    return {
      state: this.state,
      healthy: this.state !== "OPEN",
      stats: {
        fires: this.stats.fires,
        successes: this.stats.successes,
        failures: this.stats.failures,
        timeouts: this.stats.timeouts,
        rejects: this.stats.rejects,
        successRate:
          completed > 0
            ? `${((this.stats.successes / completed) * 100).toFixed(2)}%`
            : "N/A",
        avgLatency:
          completed > 0
            ? `${(this.stats.latencyTotal / completed).toFixed(2)}ms`
            : "N/A",
      },
    };
  }

  #recordOutcome(failed) {
    const now = this.now();
    const windowStart = now - this.options.rollingCountTimeout;
    this.outcomes = this.outcomes.filter(
      (outcome) => outcome.timestamp > windowStart
    );
    this.outcomes.push({ failed, timestamp: now });
  }

  #open() {
    this.state = "OPEN";
    this.openedAt = this.now();
    this.halfOpenRequestInFlight = false;
    logger.error(`Circuit OPEN for ${this.serviceName}`);
  }
}

export function getServiceCircuitBreaker(serviceName) {
  if (!circuitBreakers.has(serviceName)) {
    circuitBreakers.set(serviceName, new ProxyCircuitBreaker(serviceName));
  }
  return circuitBreakers.get(serviceName);
}

export function getAllCircuitBreakerStatuses() {
  return Object.fromEntries(
    [...circuitBreakers.entries()].map(([serviceName, breaker]) => [
      serviceName,
      breaker.getStatus(),
    ])
  );
}

export function resetCircuitBreaker(serviceName) {
  const breaker = circuitBreakers.get(serviceName);
  if (!breaker) return false;
  breaker.reset();
  logger.info(`Circuit breaker reset for ${serviceName}`);
  return true;
}

export function resetAllCircuitBreakers() {
  for (const [serviceName, breaker] of circuitBreakers) {
    breaker.reset();
    logger.info(`Circuit breaker reset for ${serviceName}`);
  }
}
