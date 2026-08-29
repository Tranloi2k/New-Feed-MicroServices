import prisma from "../lib/prisma.js";

const PLATFORMS = new Set(["android", "ios", "web"]);
const MAX_TOKEN_LENGTH = 4096;

export function validateDeviceInput(input) {
  const token = typeof input?.token === "string" ? input.token.trim() : "";
  const platform = input?.platform ? String(input.platform) : "android";

  if (!token || token.length > MAX_TOKEN_LENGTH) {
    return { error: "token must be a non-empty string" };
  }
  if (!PLATFORMS.has(platform)) {
    return { error: "platform must be android, ios or web" };
  }
  return { token, platform };
}

/**
 * A device token identifies a device, not a person: when a second account signs
 * in on the same phone the row moves to that user instead of duplicating, so
 * the previous owner stops receiving that device's notifications.
 */
export async function registerDeviceToken({ userId, token, platform }, db = prisma) {
  return db.deviceToken.upsert({
    where: { token },
    update: { userId, platform },
    create: { userId, token, platform },
  });
}

export async function removeDeviceToken(token, db = prisma) {
  const result = await db.deviceToken.deleteMany({ where: { token } });
  return result.count > 0;
}

export async function listTokensForUsers(userIds, db = prisma) {
  const ids = [...new Set(userIds)].filter((id) => Number.isSafeInteger(id) && id > 0);
  if (!ids.length) return [];
  const rows = await db.deviceToken.findMany({
    where: { userId: { in: ids } },
    select: { token: true },
  });
  return rows.map((row) => row.token);
}

export async function deleteTokens(tokens, db = prisma) {
  if (!tokens.length) return 0;
  const result = await db.deviceToken.deleteMany({ where: { token: { in: tokens } } });
  return result.count;
}
