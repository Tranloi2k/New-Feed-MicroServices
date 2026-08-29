import assert from "node:assert/strict";
import test from "node:test";
import { generateKeyPairSync } from "node:crypto";
import {
  readServiceAccount,
  resetAccessTokenCache,
  sendPushToTokens,
} from "../src/services/pushSender.js";
import { pushChatMessage } from "../src/services/pushNotifier.js";
import { validateDeviceInput } from "../src/services/deviceTokenStore.js";
import { processEventOnce } from "../src/services/eventListener.js";

const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

function serviceAccountJson() {
  return JSON.stringify({
    project_id: "newfeed-test",
    client_email: "pusher@newfeed-test.iam.gserviceaccount.com",
    private_key: privateKey,
  });
}

function fetchDouble(handlers) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    const handler = url.includes("oauth2") ? handlers.token : handlers.send;
    return handler(url, init, calls.length);
  };
  return { fetchImpl, calls };
}

const ok = async () => ({ ok: true, status: 200, json: async () => ({}) });
const tokenOk = async () => ({
  ok: true,
  status: 200,
  json: async () => ({ access_token: "access-123", expires_in: 3600 }),
});

function fcmError(errorCode, status = 404) {
  return async () => ({
    ok: false,
    status,
    json: async () => ({
      error: {
        status: "NOT_FOUND",
        details: [{ "@type": "type.googleapis.com/google.firebase.fcm.v1.FcmError", errorCode }],
      },
    }),
  });
}

test("service account parsing restores escaped newlines and rejects incomplete keys", () => {
  const account = readServiceAccount(
    JSON.stringify({
      project_id: "p",
      client_email: "e@x.iam.gserviceaccount.com",
      private_key: "-----BEGIN-----\\nline\\n-----END-----",
    })
  );
  assert.match(account.privateKey, /\n/);
  assert.equal(account.privateKey.includes("\\n"), false);

  assert.equal(readServiceAccount(undefined), null);
  assert.throws(() => readServiceAccount("not json"), /service account JSON/);
  assert.throws(() => readServiceAccount(JSON.stringify({ project_id: "p" })), /needs project_id/);
});

test("push is a no-op when Firebase is not configured", async () => {
  const { fetchImpl, calls } = fetchDouble({ token: tokenOk, send: ok });
  const result = await sendPushToTokens(["a"], {}, { fetchImpl, account: null });

  assert.deepEqual(result, { sent: 0, deadTokens: [] });
  assert.equal(calls.length, 0, "no network call without credentials");
});

test("one access token is fetched and reused across every device", async () => {
  resetAccessTokenCache();
  const { fetchImpl, calls } = fetchDouble({ token: tokenOk, send: ok });
  const account = readServiceAccount(serviceAccountJson());

  const result = await sendPushToTokens(["t1", "t2", "t3"], { notification: {} }, { fetchImpl, account });

  assert.equal(result.sent, 3);
  assert.equal(calls.filter((call) => call.url.includes("oauth2")).length, 1);
  const send = calls.find((call) => call.url.includes("fcm.googleapis.com"));
  assert.match(send.url, /projects\/newfeed-test\/messages:send/);
  assert.equal(send.init.headers.Authorization, "Bearer access-123");
  assert.equal(JSON.parse(send.init.body).message.token, "t1");
});

test("UNREGISTERED marks a token dead but a malformed message never does", async () => {
  resetAccessTokenCache();
  const account = readServiceAccount(serviceAccountJson());

  const dead = fetchDouble({ token: tokenOk, send: fcmError("UNREGISTERED") });
  assert.deepEqual(
    (await sendPushToTokens(["gone"], {}, { fetchImpl: dead.fetchImpl, account })).deadTokens,
    ["gone"]
  );

  resetAccessTokenCache();
  const malformed = fetchDouble({ token: tokenOk, send: fcmError("INVALID_ARGUMENT", 400) });
  assert.deepEqual(
    (await sendPushToTokens(["good"], {}, { fetchImpl: malformed.fetchImpl, account })).deadTokens,
    [],
    "a payload bug must not wipe the token table"
  );
});

test("chat push targets offline recipients, stringifies data and prunes dead tokens", async () => {
  let asked = null;
  let pruned = null;
  let payload = null;

  const result = await pushChatMessage(
    {
      offlineRecipientIds: [4, 9],
      conversationId: "01CONV",
      messageId: "01MSG",
      senderName: "Lan",
      preview: "chào bạn",
    },
    {
      listTokens: async (ids) => {
        asked = ids;
        return ["t1", "t2"];
      },
      send: async (tokens, message) => {
        payload = message;
        return { sent: 1, deadTokens: ["t2"] };
      },
      prune: async (tokens) => {
        pruned = tokens;
        return tokens.length;
      },
    }
  );

  assert.deepEqual(asked, [4, 9]);
  assert.deepEqual(result, { sent: 1, pruned: 1 });
  assert.deepEqual(pruned, ["t2"]);
  assert.equal(payload.notification.title, "Lan");
  assert.equal(payload.android.priority, "high");
  for (const value of Object.values(payload.data)) {
    assert.equal(typeof value, "string", "FCM v1 rejects non-string data values");
  }
});

test("chat push skips the network when nobody is offline", async () => {
  const result = await pushChatMessage(
    { offlineRecipientIds: [], conversationId: "c", messageId: "m" },
    { listTokens: async () => assert.fail("must not query tokens") }
  );
  assert.deepEqual(result, { sent: 0, pruned: 0 });
});

test("a failing push still lets the chat event be acknowledged", async () => {
  const event = {
    eventId: "evt-1",
    eventType: "chat.message.created",
    version: 1,
    data: {
      conversationId: "01CONV",
      messageId: "01MSG",
      senderId: 1,
      recipientIds: [2],
      preview: "hi",
    },
  };
  const db = {
    processedEvent: { findUnique: async () => null, create: async () => ({}) },
    notification: {
      create: async ({ data }) => ({ id: "n1", ...data, read: false, createdAt: new Date() }),
    },
    $transaction: async (fn) => fn(db),
  };
  const emitted = [];
  const io = { to: () => ({ emit: (name) => emitted.push(name) }) };

  const handled = await processEventOnce(io, event, db, {
    isUserOnline: async () => false,
    sendChatPush: async () => {
      throw new Error("FCM unreachable");
    },
  });

  assert.equal(handled, true, "a push outage must not requeue the event");
  assert.deepEqual(emitted, ["notification"]);
});

test("device input validation guards the column and the platform set", () => {
  assert.deepEqual(validateDeviceInput({ token: "  abc  " }), { token: "abc", platform: "android" });
  assert.equal(validateDeviceInput({ token: "" }).error, "token must be a non-empty string");
  assert.equal(validateDeviceInput({ token: "x".repeat(5000) }).error, "token must be a non-empty string");
  assert.match(validateDeviceInput({ token: "abc", platform: "symbian" }).error, /android, ios or web/);
});
