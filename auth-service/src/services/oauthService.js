import jwt from "jsonwebtoken";
import { randomInt } from "node:crypto";
import prisma from "../lib/prisma.js";
import { getOAuthConfig } from "../config/env.js";
import { AppError } from "../utils/appError.js";
import { normalizeEmail, validateEmail } from "../utils/validation.js";

const GOOGLE_CERTS_URL = "https://www.googleapis.com/oauth2/v1/certs";
const GOOGLE_ISSUERS = ["accounts.google.com", "https://accounts.google.com"];
const PROVIDER_TIMEOUT_MS = 5_000;
const DEFAULT_CERT_TTL_MS = 60 * 60 * 1000;
// An unknown `kid` refetches the certs (key rotation), but no more often than
// this so forged tokens cannot turn the service into a request amplifier.
const MIN_FORCED_REFRESH_MS = 60 * 1000;

const USERNAME_MAX_LENGTH = 30;
const USERNAME_ATTEMPTS = 5;

function invalidToken(message = "Invalid OAuth token") {
  return new AppError("OAUTH_INVALID_TOKEN", message, 401);
}

function emailUnverified() {
  return new AppError(
    "OAUTH_EMAIL_UNVERIFIED",
    "OAuth account has no verified email",
    403
  );
}

function providerUnavailable() {
  return new AppError(
    "OAUTH_PROVIDER_UNAVAILABLE",
    "OAuth provider is unavailable",
    502
  );
}

async function requestJson(fetchImpl, url, init = {}) {
  let response;
  try {
    response = await fetchImpl(url, {
      ...init,
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    });
  } catch {
    throw providerUnavailable();
  }

  if (!response.ok) return { ok: false, status: response.status };
  return { ok: true, body: await response.json(), headers: response.headers };
}

// ---------------------------------------------------------------------------
// Google: verify the OIDC id_token locally against Google's signing certs.
// ---------------------------------------------------------------------------

let googleCerts = { certs: null, expiresAt: 0, fetchedAt: 0 };

export function resetGoogleCertCache() {
  googleCerts = { certs: null, expiresAt: 0, fetchedAt: 0 };
}

function maxAgeMs(headers) {
  const match = /max-age=(\d+)/i.exec(headers?.get?.("cache-control") || "");
  return match ? Number(match[1]) * 1000 : DEFAULT_CERT_TTL_MS;
}

async function getGoogleCerts(fetchImpl, { force = false } = {}) {
  const now = Date.now();
  const fresh = googleCerts.certs && googleCerts.expiresAt > now;
  const throttled = now - googleCerts.fetchedAt < MIN_FORCED_REFRESH_MS;
  if (fresh && (!force || throttled)) return googleCerts.certs;

  const result = await requestJson(fetchImpl, GOOGLE_CERTS_URL);
  if (!result.ok) throw providerUnavailable();

  googleCerts = {
    certs: result.body,
    expiresAt: now + maxAgeMs(result.headers),
    fetchedAt: now,
  };
  return googleCerts.certs;
}

export async function verifyGoogleIdToken(idToken, { clientIds, fetchImpl = fetch }) {
  if (typeof idToken !== "string" || !idToken) {
    throw invalidToken("idToken is required");
  }

  const kid = jwt.decode(idToken, { complete: true })?.header?.kid;
  if (typeof kid !== "string") throw invalidToken();

  let certs = await getGoogleCerts(fetchImpl);
  if (!certs[kid]) certs = await getGoogleCerts(fetchImpl, { force: true });
  if (!certs[kid]) throw invalidToken();

  let claims;
  try {
    claims = jwt.verify(idToken, certs[kid], {
      algorithms: ["RS256"],
      audience: clientIds,
      issuer: GOOGLE_ISSUERS,
    });
  } catch {
    throw invalidToken();
  }

  if (!claims.sub) throw invalidToken();
  if (claims.email_verified !== true && claims.email_verified !== "true") {
    throw emailUnverified();
  }

  const email = normalizeEmail(claims.email);
  return {
    provider: "google",
    providerAccountId: String(claims.sub),
    email,
    fullName: claims.name || null,
    avatarUrl: claims.picture || null,
    usernameHint: email.split("@")[0],
  };
}

export async function verifyOAuthIdentity(
  provider,
  { idToken } = {},
  { config = getOAuthConfig(), fetchImpl = fetch } = {}
) {
  if (provider === "google" && config.google) {
    return verifyGoogleIdToken(idToken, { ...config.google, fetchImpl });
  }
  throw new AppError(
    "OAUTH_PROVIDER_UNSUPPORTED",
    "OAuth provider is not supported",
    404
  );
}

// ---------------------------------------------------------------------------
// Account linking
// ---------------------------------------------------------------------------

export function usernameBase(hint) {
  const base = String(hint || "")
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, USERNAME_MAX_LENGTH - 5);
  return base.length >= 3 ? base : `user_${base}`.replace(/_+$/, "");
}

async function availableUsername(db, hint) {
  const base = usernameBase(hint);
  for (let attempt = 0; attempt < USERNAME_ATTEMPTS; attempt += 1) {
    const candidate = attempt === 0 ? base : `${base}_${randomInt(1000, 10000)}`;
    const taken = await db.user.findUnique({
      where: { username: candidate },
      select: { id: true },
    });
    if (!taken) return candidate;
  }
  throw new AppError("OAUTH_USERNAME_UNAVAILABLE", "Could not allocate a username", 409);
}

async function linkOrCreateUser(identity, db) {
  const { provider, providerAccountId } = identity;
  const linked = await db.oAuthAccount.findUnique({
    where: { provider_providerAccountId: { provider, providerAccountId } },
    include: { user: true },
  });
  if (linked) return linked.user;

  if (validateEmail(identity.email)) {
    throw invalidToken("OAuth provider did not return a valid email");
  }

  return db.$transaction(async (tx) => {
    const existing = await tx.user.findFirst({
      where: { email: { equals: identity.email, mode: "insensitive" } },
      select: { id: true },
    });
    // Signup does not verify email ownership, so silently linking would let
    // someone pre-register a victim's email and share the account later.
    if (existing) {
      throw new AppError(
        "OAUTH_ACCOUNT_NOT_LINKED",
        "An account with this email already exists. Sign in with your password.",
        409
      );
    }

    const user = await tx.user.create({
      data: {
        username: await availableUsername(tx, identity.usernameHint || identity.email),
        email: identity.email,
        passwordHash: null,
        fullName: identity.fullName?.slice(0, 100) || null,
        avatarUrl: identity.avatarUrl,
      },
    });
    await tx.oAuthAccount.create({
      data: { userId: user.id, provider, providerAccountId },
    });
    return user;
  });
}

/** Return the user for a verified provider identity, creating it on first login. */
export async function findOrCreateOAuthUser(identity, db = prisma) {
  try {
    return await linkOrCreateUser(identity, db);
  } catch (error) {
    // A concurrent first login for the same identity (or a username race) hit
    // a unique constraint; the retry finds the row the other request created.
    if (error?.code !== "P2002") throw error;
    return linkOrCreateUser(identity, db);
  }
}
