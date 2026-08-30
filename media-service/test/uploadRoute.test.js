import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import upload, { MAX_FILES } from "../src/middleware/upload.js";
import { uploadErrorHandler } from "../src/middleware/errorHandler.js";

const MB = 1024 * 1024;

function startServer() {
  const app = express();
  app.post("/api/media/upload", upload.array("media", MAX_FILES), (req, res) =>
    res.json({ success: true, count: req.files.length })
  );
  app.use(uploadErrorHandler);
  const server = app.listen(0, "127.0.0.1");
  return new Promise((resolve) => server.once("listening", () => resolve(server)));
}

async function post(server, files) {
  const form = new FormData();
  for (const [name, size, type] of files) {
    form.append("media", new Blob([Buffer.alloc(size)], { type }), name);
  }
  const response = await fetch(
    `http://127.0.0.1:${server.address().port}/api/media/upload`,
    { method: "POST", body: form }
  );
  return { status: response.status, body: await response.json() };
}

test("a request inside the limits is accepted", async () => {
  const server = await startServer();
  try {
    const result = await post(server, Array(MAX_FILES).fill(["a.jpg", 1 * MB, "image/jpeg"]));
    assert.equal(result.status, 200);
    assert.equal(result.body.count, MAX_FILES);
  } finally {
    server.close();
  }
});

test("too many files and oversized files each get their own status", async () => {
  const server = await startServer();
  try {
    const tooMany = await post(server, Array(MAX_FILES + 1).fill(["a.jpg", 1024, "image/jpeg"]));
    assert.equal(tooMany.status, 400);
    assert.equal(tooMany.body.code, "LIMIT_FILE_COUNT");

    const tooBig = await post(server, [["big.jpg", 9 * MB, "image/jpeg"]]);
    assert.equal(tooBig.status, 413);
    assert.equal(tooBig.body.code, "LIMIT_FILE_SIZE");
  } finally {
    server.close();
  }
});

test("a rejected file type answers 415 instead of resetting the connection", async () => {
  const server = await startServer();
  try {
    // Large enough that the client is still sending when multer rejects: this
    // is the case that used to surface as ECONNRESET, then as a gateway 504.
    const result = await post(server, [["payload.exe", 6 * MB, "application/x-msdownload"]]);
    assert.equal(result.status, 415);
    assert.equal(result.body.success, false);
    assert.match(result.body.message, /Invalid file type/);
  } finally {
    server.close();
  }
});
