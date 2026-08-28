import { randomBytes, randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import prisma from "../lib/prisma.js";
import { getBcryptRounds } from "../config/env.js";

export const ACCESS_TOKEN_TTL_SECONDS = 30 * 60;
export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const REFRESH_COOKIE_PATH = "/api/auth";

function jwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET is required");
  return secret;
}

function newRefreshToken() {
  const id = randomUUID();
  const secret = randomBytes(48).toString("base64url");
  return { id, secret, value: `${id}.${secret}` };
}

function parseRefreshToken(value) {
  if (typeof value !== "string") return null;
  const separator = value.indexOf(".");
  if (separator <= 0 || separator === value.length - 1) return null;
  return { id: value.slice(0, separator), secret: value.slice(separator + 1) };
}

export function createAccessToken(user) {
  return jwt.sign(
    {
      userId: user.id,
      username: user.username,
      email: user.email,
    },
    jwtSecret(),
    {
      algorithm: "HS256",
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
      jwtid: randomUUID(),
    }
  );
}

async function buildRefreshRecord(userId) {
  const token = newRefreshToken();
  return {
    value: token.value,
    data: {
      id: token.id,
      userId,
      tokenHash: await bcrypt.hash(token.secret, getBcryptRounds()),
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
    },
  };
}

export async function issueSession(user, db = prisma) {
  const refresh = await buildRefreshRecord(user.id);
  await db.refreshToken.create({ data: refresh.data });
  return {
    accessToken: createAccessToken(user),
    refreshToken: refresh.value,
    user,
  };
}

export async function rotateSession(rawToken, db = prisma) {
  const parsed = parseRefreshToken(rawToken);
  if (!parsed) return null;

  const current = await db.refreshToken.findUnique({
    where: { id: parsed.id },
    include: { user: true },
  });
  if (!current || !(await bcrypt.compare(parsed.secret, current.tokenHash))) {
    return null;
  }

  if (current.revokedAt) return null;
  if (current.expiresAt <= new Date()) return null;

  const replacement = await buildRefreshRecord(current.userId);
  const rotated = await db.$transaction(async (tx) => {
    const claimed = await tx.refreshToken.updateMany({
      where: {
        id: current.id,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      data: {
        revokedAt: new Date(),
        replacedById: replacement.data.id,
      },
    });
    if (claimed.count !== 1) return false;
    await tx.refreshToken.create({ data: replacement.data });
    return true;
  });
  if (!rotated) return null;

  return {
    accessToken: createAccessToken(current.user),
    refreshToken: replacement.value,
    user: current.user,
  };
}

export async function revokeSession(rawToken, db = prisma) {
  const parsed = parseRefreshToken(rawToken);
  if (!parsed) return false;
  const current = await db.refreshToken.findUnique({ where: { id: parsed.id } });
  if (!current || !(await bcrypt.compare(parsed.secret, current.tokenHash))) {
    return false;
  }
  const result = await db.refreshToken.updateMany({
    where: { id: current.id, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return result.count === 1;
}

function cookieSecurity() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
  };
}

export function setSessionCookies(res, session) {
  const security = cookieSecurity();
  res.cookie("access_token", session.accessToken, {
    ...security,
    path: "/",
    maxAge: ACCESS_TOKEN_TTL_SECONDS * 1000,
  });
  res.cookie("refresh_token", session.refreshToken, {
    ...security,
    path: REFRESH_COOKIE_PATH,
    maxAge: REFRESH_TOKEN_TTL_MS,
  });
}

export function clearSessionCookies(res) {
  const security = cookieSecurity();
  res.clearCookie("access_token", { ...security, path: "/" });
  res.clearCookie("refresh_token", {
    ...security,
    path: REFRESH_COOKIE_PATH,
  });
}
