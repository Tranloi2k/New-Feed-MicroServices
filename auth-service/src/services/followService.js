import prisma from "../lib/prisma.js";

export async function getFollowCounts(userId) {
  const [followersCount, followingCount] = await Promise.all([
    prisma.follow.count({ where: { followingId: userId } }),
    prisma.follow.count({ where: { followerId: userId } }),
  ]);
  return { followersCount, followingCount };
}

export async function isFollowing(followerId, followingId) {
  if (!followerId || followerId === followingId) return false;
  const row = await prisma.follow.findUnique({
    where: {
      followerId_followingId: { followerId, followingId },
    },
  });
  return Boolean(row);
}

export async function followUser(followerId, followingId) {
  if (followerId === followingId) {
    throw new Error("Cannot follow yourself");
  }

  const target = await prisma.user.findUnique({ where: { id: followingId } });
  if (!target) {
    throw new Error("User not found");
  }

  await prisma.follow.upsert({
    where: {
      followerId_followingId: { followerId, followingId },
    },
    create: { followerId, followingId },
    update: {},
  });

  return getFollowCounts(followingId);
}

export async function unfollowUser(followerId, followingId) {
  await prisma.follow.deleteMany({
    where: { followerId, followingId },
  });
  return getFollowCounts(followingId);
}

export async function getFollowingIds(userId) {
  const rows = await prisma.follow.findMany({
    where: { followerId: userId },
    select: { followingId: true },
  });
  return rows.map((r) => r.followingId);
}

export async function listFollowers(userId, { limit = 20, cursor }) {
  const take = Math.min(Math.max(limit, 1), 50);
  const skip = cursor ? parseInt(cursor, 10) : 0;
  const rows = await prisma.follow.findMany({
    where: { followingId: userId },
    skip,
    take: take + 1,
    orderBy: { createdAt: "desc" },
    include: {
      follower: {
        select: {
          id: true,
          username: true,
          fullName: true,
          avatarUrl: true,
          bio: true,
        },
      },
    },
  });

  const hasMore = rows.length > take;
  const items = hasMore ? rows.slice(0, take) : rows;

  return {
    users: items.map((r) => r.follower),
    hasMore,
    nextCursor: hasMore ? String(skip + take) : null,
  };
}

export async function listFollowing(userId, { limit = 20, cursor }) {
  const take = Math.min(Math.max(limit, 1), 50);
  const skip = cursor ? parseInt(cursor, 10) : 0;
  const rows = await prisma.follow.findMany({
    where: { followerId: userId },
    skip,
    take: take + 1,
    orderBy: { createdAt: "desc" },
    include: {
      following: {
        select: {
          id: true,
          username: true,
          fullName: true,
          avatarUrl: true,
          bio: true,
        },
      },
    },
  });

  const hasMore = rows.length > take;
  const items = hasMore ? rows.slice(0, take) : rows;

  return {
    users: items.map((r) => r.following),
    hasMore,
    nextCursor: hasMore ? String(skip + take) : null,
  };
}
