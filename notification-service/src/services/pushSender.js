import jwt from "jsonwebtoken";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
const GRANT_TYPE = "urn:ietf:params:oauth:grant-type:jwt-bearer";
const ACCESS_TOKEN_SKEW_MS = 60 * 1000;

// Only codes that mean "this token will never work again". INVALID_ARGUMENT is
// deliberately absent: FCM also returns it for a malformed message, so trusting
// it would delete every token in the table the first time we ship a bad payload.
const DEAD_TOKEN_CODES = new Set([
  "UNREGISTERED",
  "NOT_FOUND",
  "SENDER_ID_MISMATCH",
]);

let cachedAccessToken = null;

/** Parses the service account JSON. Returns null when push is not configured. */
export function readServiceAccount(raw = process.env.FIREBASE_SERVICE_ACCOUNT) {
  if (!raw) return null;

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("FIREBASE_SERVICE_ACCOUNT must contain the service account JSON");
  }

  const projectId = parsed.project_id;
  const clientEmail = parsed.client_email;
  const privateKey = parsed.private_key;
  if (!projectId || !clientEmail || !privateKey) {
    throw new Error(
      "FIREBASE_SERVICE_ACCOUNT needs project_id, client_email and private_key"
    );
  }

  return {
    projectId,
    clientEmail,
    // Keys pasted through env files keep their newlines escaped.
    privateKey: privateKey.replace(/\\n/g, "\n"),
  };
}

export function resetAccessTokenCache() {
  cachedAccessToken = null;
}

async function getAccessToken(account, fetchImpl, now) {
  if (cachedAccessToken && cachedAccessToken.expiresAt > now + ACCESS_TOKEN_SKEW_MS) {
    return cachedAccessToken.value;
  }

  const assertion = jwt.sign({ scope: SCOPE }, account.privateKey, {
    algorithm: "RS256",
    issuer: account.clientEmail,
    subject: account.clientEmail,
    audience: TOKEN_URL,
    expiresIn: 3600,
  });

  const response = await fetchImpl(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: GRANT_TYPE, assertion }).toString(),
  });

  if (!response.ok) {
    throw new Error(`FCM access token request failed with ${response.status}`);
  }

  const body = await response.json();
  if (!body.access_token) throw new Error("FCM access token response had no token");

  cachedAccessToken = {
    value: body.access_token,
    expiresAt: now + Number(body.expires_in || 3600) * 1000,
  };
  return cachedAccessToken.value;
}

function readErrorCode(body) {
  const details = body?.error?.details;
  const fcmError = Array.isArray(details)
    ? details.find((detail) => String(detail?.["@type"] || "").includes("FcmError"))
    : null;
  return fcmError?.errorCode || body?.error?.status || null;
}

/**
 * Sends one FCM v1 message per token. Never throws for a single bad token:
 * the caller gets the tokens FCM rejected as permanently dead so it can prune
 * them, while transient failures are only logged.
 */
export async function sendPushToTokens(
  tokens,
  message,
  { fetchImpl = fetch, account = readServiceAccount(), now = Date.now() } = {}
) {
  const deadTokens = [];
  if (!account || !tokens.length) return { sent: 0, deadTokens };

  const accessToken = await getAccessToken(account, fetchImpl, now);
  const url = `https://fcm.googleapis.com/v1/projects/${account.projectId}/messages:send`;
  let sent = 0;

  for (const token of tokens) {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ message: { ...message, token } }),
    });

    if (response.ok) {
      sent += 1;
      continue;
    }

    const body = await response.json().catch(() => ({}));
    const code = readErrorCode(body);
    if (DEAD_TOKEN_CODES.has(code)) {
      deadTokens.push(token);
    } else {
      console.error("FCM send failed", { status: response.status, code });
    }
  }

  return { sent, deadTokens };
}
