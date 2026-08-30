import prisma from "../lib/prisma.js";
import { cacheUser, getCachedUser } from "./cacheService.js";

const USER_SELECT = {
  id: true,
  username: true,
  email: true,
  fullName: true,
  avatarUrl: true,
  bio: true,
  isPrivate: true,
  createdAt: true,
};

export async function findUserById(userId) {
  const cached = await getCachedUser(userId);
  if (cached) return cached;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: USER_SELECT,
  });
  if (user) await cacheUser(userId, user);
  return user;
}

export function toInternalUser(user) {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    fullName: user.fullName,
    avatarUrl: user.avatarUrl,
  };
}

/**
 * Bulk lookup for service-to-service calls. Cached users are answered from
 * Redis and only the remainder reaches Postgres, so a page of comments costs
 * one query instead of one per author.
 */
export async function findUsersByIds(userIds) {
  const ids = [...new Set(userIds)].filter(
    (id) => Number.isSafeInteger(id) && id > 0
  );
  if (!ids.length) return [];

  const found = [];
  const missing = [];
  for (const id of ids) {
    const cached = await getCachedUser(id);
    if (cached) found.push(cached);
    else missing.push(id);
  }

  if (missing.length) {
    const users = await prisma.user.findMany({
      where: { id: { in: missing } },
      select: USER_SELECT,
    });
    for (const user of users) {
      await cacheUser(user.id, user);
      found.push(user);
    }
  }

  return found;
}
