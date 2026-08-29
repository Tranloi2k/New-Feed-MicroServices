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
