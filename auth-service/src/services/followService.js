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

export async function hasPendingFollowRequest(followerId, followingId) {
  if (!followerId || followerId === followingId) return false;
  return Boolean(
    await prisma.followRequest.findUnique({
      where: { followerId_followingId: { followerId, followingId } },
    })
  );
}

export async function followUser(followerId, followingId) {
  if (followerId === followingId) {
    throw new Error("Cannot follow yourself");
  }

  const target = await prisma.user.findUnique({
    where: { id: followingId },
    select: { id: true, isPrivate: true },
  });
  if (!target) {
    throw new Error("User not found");
  }

  if (target.isPrivate) {
    const existingFollow = await isFollowing(followerId, followingId);
    if (!existingFollow) {
      await prisma.followRequest.upsert({
        where: { followerId_followingId: { followerId, followingId } },
        create: { followerId, followingId },
        update: {},
      });
    }
    return {
      ...(await getFollowCounts(followingId)),
      isFollowing: existingFollow,
      followRequested: !existingFollow,
    };
  }

  await prisma.$transaction([
    prisma.follow.upsert({
      where: { followerId_followingId: { followerId, followingId } },
      create: { followerId, followingId },
      update: {},
    }),
    prisma.followRequest.deleteMany({ where: { followerId, followingId } }),
  ]);

  return {
    ...(await getFollowCounts(followingId)),
    isFollowing: true,
    followRequested: false,
  };
}

export async function unfollowUser(followerId, followingId) {
  await prisma.$transaction([
    prisma.follow.deleteMany({ where: { followerId, followingId } }),
    prisma.followRequest.deleteMany({ where: { followerId, followingId } }),
  ]);
  return getFollowCounts(followingId);
}

export async function canViewConnections(viewerId, userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { isPrivate: true },
  });
  if (!user) throw new Error("User not found");
  if (!user.isPrivate || viewerId === userId) return true;
  return isFollowing(viewerId, userId);
}

export async function listFollowRequests(userId, { limit = 20, cursor = 0 }) {
  const rows = await prisma.followRequest.findMany({
    where: { followingId: userId },
    skip: cursor,
    take: limit + 1,
    orderBy: { createdAt: "desc" },
    include: {
      follower: {
        select: { id: true, username: true, fullName: true, avatarUrl: true, bio: true },
      },
    },
  });
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  return {
    users: items.map((row) => row.follower),
    hasMore,
    nextCursor: hasMore ? String(cursor + limit) : null,
  };
}

export async function acceptFollowRequest(userId, followerId) {
  await prisma.$transaction(async (tx) => {
    const removed = await tx.followRequest.deleteMany({
      where: { followerId, followingId: userId },
    });
    if (removed.count !== 1) throw new Error("Follow request not found");
    await tx.follow.upsert({
      where: { followerId_followingId: { followerId, followingId: userId } },
      create: { followerId, followingId: userId },
      update: {},
    });
  });
  return getFollowCounts(userId);
}

export async function rejectFollowRequest(userId, followerId) {
  const removed = await prisma.followRequest.deleteMany({
    where: { followerId, followingId: userId },
  });
  if (removed.count !== 1) throw new Error("Follow request not found");
}

export async function getFollowingIds(userId, { limit = 500, cursor = 0 } = {}) {
  const rows = await prisma.follow.findMany({
    where: { followerId: userId },
    select: { followingId: true },
    orderBy: { followingId: "asc" },
    skip: cursor,
    take: limit + 1,
  });
  const hasMore = rows.length > limit;
  return {
    ids: (hasMore ? rows.slice(0, limit) : rows).map((row) => row.followingId),
    nextCursor: hasMore ? String(cursor + limit) : null,
  };
}

export async function getFollowerIds(userId, { limit = 500, cursor = 0 } = {}) {
  const rows = await prisma.follow.findMany({
    where: { followingId: userId },
    select: { followerId: true },
    orderBy: { followerId: "asc" },
    skip: cursor,
    take: limit + 1,
  });
  const hasMore = rows.length > limit;
  return {
    ids: (hasMore ? rows.slice(0, limit) : rows).map((row) => row.followerId),
    nextCursor: hasMore ? String(cursor + limit) : null,
  };
}

export async function listFollowers(userId, { limit = 20, cursor = 0 }) {
  const take = limit;
  const skip = cursor;
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

export async function listFollowing(userId, { limit = 20, cursor = 0 }) {
  const take = limit;
  const skip = cursor;
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
