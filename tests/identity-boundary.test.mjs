import assert from "node:assert/strict";
import test from "node:test";

import {
  forwardUserHeaders,
  stripUntrustedIdentityHeaders,
} from "../api-gateway/src/utils/proxyHelpers.js";
import { getTrustedIdentity as getAuthIdentity } from "../auth-service/src/middleware/trustedIdentity.js";
import { getTrustedIdentity as getPostIdentity } from "../post-service/src/middleware/trustedIdentity.js";
import { getTrustedIdentity as getCommentIdentity } from "../comment-service/src/middleware/trustedIdentity.js";
import { getTrustedIdentity as getNotificationIdentity } from "../notification-service/src/middleware/trustedIdentity.js";

const SERVICE_SECRET = "test-service-secret";
const identityReaders = [
  ["auth", getAuthIdentity],
  ["post", getPostIdentity],
  ["comment", getCommentIdentity],
  ["notification", getNotificationIdentity],
];

function createProxyRequest(initialHeaders = {}) {
  const headers = new Map(
    Object.entries(initialHeaders).map(([key, value]) => [
      key.toLowerCase(),
      String(value),
    ])
  );

  return {
    removeHeader(name) {
      headers.delete(name.toLowerCase());
    },
    setHeader(name, value) {
      headers.set(name.toLowerCase(), String(value));
    },
    getHeader(name) {
      return headers.get(name.toLowerCase());
    },
  };
}

test("gateway removes client-supplied internal identity headers", () => {
  const req = {
    headers: {
      "x-user-id": "999",
      "x-user-email": "attacker@example.com",
      "x-service-token": "forged-token",
      authorization: "Bearer client-token",
    },
  };
  let nextCalled = false;

  stripUntrustedIdentityHeaders(req, {}, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.equal(req.headers["x-user-id"], undefined);
  assert.equal(req.headers["x-user-email"], undefined);
  assert.equal(req.headers["x-service-token"], undefined);
  assert.equal(req.headers.authorization, "Bearer client-token");
});

test("gateway forwards only its authenticated identity", () => {
  const previousSecret = process.env.SERVICE_SECRET;
  process.env.SERVICE_SECRET = SERVICE_SECRET;

  try {
    const proxyReq = createProxyRequest({
      "x-user-id": "999",
      "x-user-email": "attacker@example.com",
      "x-service-token": "forged-token",
    });

    forwardUserHeaders(proxyReq, {
      user: { userId: 42, email: "user@example.com" },
    });

    assert.equal(proxyReq.getHeader("x-user-id"), "42");
    assert.equal(proxyReq.getHeader("x-user-email"), "user@example.com");
    assert.equal(proxyReq.getHeader("x-service-token"), SERVICE_SECRET);
  } finally {
    if (previousSecret === undefined) {
      delete process.env.SERVICE_SECRET;
    } else {
      process.env.SERVICE_SECRET = previousSecret;
    }
  }
});

test("anonymous gateway requests cannot preserve a spoofed identity", () => {
  const previousSecret = process.env.SERVICE_SECRET;
  process.env.SERVICE_SECRET = SERVICE_SECRET;

  try {
    const proxyReq = createProxyRequest({
      "x-user-id": "999",
      "x-user-email": "attacker@example.com",
      "x-service-token": "forged-token",
    });

    forwardUserHeaders(proxyReq, {});

    assert.equal(proxyReq.getHeader("x-user-id"), undefined);
    assert.equal(proxyReq.getHeader("x-user-email"), undefined);
    assert.equal(proxyReq.getHeader("x-service-token"), SERVICE_SECRET);
  } finally {
    if (previousSecret === undefined) {
      delete process.env.SERVICE_SECRET;
    } else {
      process.env.SERVICE_SECRET = previousSecret;
    }
  }
});

for (const [serviceName, readIdentity] of identityReaders) {
  test(`${serviceName} rejects an unsigned identity header`, () => {
    assert.equal(
      readIdentity(
        {
          "x-user-id": "42",
          "x-user-email": "user@example.com",
        },
        SERVICE_SECRET
      ),
      null
    );

    assert.equal(
      readIdentity(
        {
          "x-user-id": "42",
          "x-service-token": "wrong-secret",
        },
        SERVICE_SECRET
      ),
      null
    );
  });

  test(`${serviceName} accepts identity signed by the gateway`, () => {
    assert.deepEqual(
      readIdentity(
        {
          "x-user-id": "42",
          "x-user-email": "user@example.com",
          "x-service-token": SERVICE_SECRET,
        },
        SERVICE_SECRET
      ),
      { userId: 42, email: "user@example.com" }
    );
  });
}

