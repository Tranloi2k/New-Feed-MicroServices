import assert from "node:assert/strict";
import test from "node:test";

import { ProxyCircuitBreaker } from "../src/middleware/circuitBreaker.js";

test("circuit breaker opens from actual failures and recovers through one probe", () => {
  let now = 1_000;
  const breaker = new ProxyCircuitBreaker(
    "test",
    {
      volumeThreshold: 3,
      errorThresholdPercentage: 50,
      rollingCountTimeout: 10_000,
      resetTimeout: 500,
    },
    () => now
  );

  for (let index = 0; index < 3; index += 1) {
    assert.equal(breaker.tryAcquire(), true);
    breaker.recordFailure({ durationMs: 10 });
  }

  assert.equal(breaker.getStatus().state, "OPEN");
  assert.equal(breaker.tryAcquire(), false);

  now += 500;
  assert.equal(breaker.tryAcquire(), true);
  assert.equal(breaker.getStatus().state, "HALF_OPEN");
  assert.equal(breaker.tryAcquire(), false);

  // A late response from a request started before OPEN must not complete the probe.
  breaker.recordSuccess(2);
  assert.equal(breaker.getStatus().state, "HALF_OPEN");

  breaker.recordSuccess(5, { probe: true });
  assert.equal(breaker.getStatus().state, "CLOSED");
});

test("a failed half-open probe reopens the circuit", () => {
  let now = 1_000;
  const breaker = new ProxyCircuitBreaker(
    "test",
    { volumeThreshold: 1, resetTimeout: 100 },
    () => now
  );

  breaker.tryAcquire();
  breaker.recordFailure();
  now += 100;
  breaker.tryAcquire();
  breaker.recordFailure({ timeout: true, probe: true });

  const status = breaker.getStatus();
  assert.equal(status.state, "OPEN");
  assert.equal(status.stats.timeouts, 1);
});
