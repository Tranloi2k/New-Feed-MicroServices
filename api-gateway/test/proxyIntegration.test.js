import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import test from "node:test";
import express from "express";

import { createCircuitBreakerProxy } from "../src/middleware/circuitBreakerProxy.js";
import { restreamBody } from "../src/utils/proxyHelpers.js";

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

test("parsed and inflated JSON bodies are correctly restreamed downstream", async () => {
  const downstream = express();
  downstream.use(express.json());
  downstream.patch("/echo", (req, res) => res.json({ body: req.body }));

  const downstreamServer = await listen(downstream);
  const downstreamAddress = downstreamServer.address();
  const gateway = express();
  gateway.patch(
    "/proxy",
    express.json(),
    createCircuitBreakerProxy(
      `integration-${downstreamAddress.port}`,
      `http://127.0.0.1:${downstreamAddress.port}`,
      {
        pathRewrite: { "^/proxy": "/echo" },
        onProxyReq: restreamBody,
      }
    )
  );
  const gatewayServer = await listen(gateway);

  try {
    const body = gzipSync(JSON.stringify({ name: "New Feed" }));
    const response = await fetch(
      `http://127.0.0.1:${gatewayServer.address().port}/proxy`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "Content-Encoding": "gzip",
        },
        body,
      }
    );

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { body: { name: "New Feed" } });
  } finally {
    await close(gatewayServer);
    await close(downstreamServer);
  }
});

