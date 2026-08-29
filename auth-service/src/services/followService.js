import prisma from "../lib/prisma.js";
import { AppError } from "../utils/appError.js";

function encodeConnectionCursor(createdAt, id) {
  return Buffer.from(JSON.stringify({ createdAt: createdAt.toISOString(), id })).toString("base64url");
}

function decodeConnectionCursor(cursor) {
  if (!cursor || cursor === "0") return null;
  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    const createdAt = new Date(value.createdAt);
    if (!Number.isSafeInteger(value.id) || value.id <= 0 || Number.isNaN(createdAt.getTime())) {
      throw new Error();
    }
    return { createdAt, id: value.id };
  } catch {
    throw new AppError("INVALID_CURSOR", "Invalid cursor", 400);
  }
}

function createdAtKeyset(cursor, idField) {
  const value = decodeConnectionCursor(cursor);
  if (!value) return {};
  return {
    OR: [
      { createdAt: { lt: value.createdAt } },
      { createdAt: value.createdAt, [idField]: { lt: value.id } },
    ],
  };
}

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
    throw new AppError("CANNOT_FOLLOW_SELF", "Cannot follow yourself", 400);
  }

  const target = await prisma.user.findUnique({
    where: { id: followingId },
    select: { id: true, isPrivate: true },
  });
  if (!target) {
    throw new AppError("USER_NOT_FOUND", "User not found", 404);
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
  const target = await prisma.user.findUnique({
    where: { id: followingId },
    select: { id: true },
  });
  if (!target) throw new AppError("USER_NOT_FOUND", "User not found", 404);
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
  if (!user) throw new AppError("USER_NOT_FOUND", "User not found", 404);
  if (!user.isPrivate || viewerId === userId) return true;
  return isFollowing(viewerId, userId);
}

export async function listFollowRequests(userId, { limit = 20, cursor = null }) {
  const rows = await prisma.followRequest.findMany({
    where: { followingId: userId, ...createdAtKeyset(cursor, "followerId") },
    take: limit + 1,
    orderBy: [{ createdAt: "desc" }, { followerId: "desc" }],
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
    nextCursor: hasMore
      ? encodeConnectionCursor(items.at(-1).createdAt, items.at(-1).followerId)
      : null,
  };
}

export async function acceptFollowRequest(userId, followerId) {
  await prisma.$transaction(async (tx) => {
    const removed = await tx.followRequest.deleteMany({
      where: { followerId, followingId: userId },
    });
    if (removed.count !== 1) {
      throw new AppError("FOLLOW_REQUEST_NOT_FOUND", "Follow request not found", 404);
    }
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
  if (removed.count !== 1) {
    throw new AppError("FOLLOW_REQUEST_NOT_FOUND", "Follow request not found", 404);
  }
}

export async function getFollowingIds(userId, { limit = 500, cursor = 0 } = {}) {
  const rows = await prisma.follow.findMany({
    where: { followerId: userId, followingId: { gt: cursor } },
    select: { followingId: true },
    orderBy: { followingId: "asc" },
    take: limit + 1,
  });
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  return {
    ids: items.map((row) => row.followingId),
    nextCursor: hasMore ? String(items.at(-1).followingId) : null,
  };
}

export async function getFollowerIds(userId, { limit = 500, cursor = 0 } = {}) {
  const rows = await prisma.follow.findMany({
    where: { followingId: userId, followerId: { gt: cursor } },
    select: { followerId: true },
    orderBy: { followerId: "asc" },
    take: limit + 1,
  });
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  return {
    ids: items.map((row) => row.followerId),
    nextCursor: hasMore ? String(items.at(-1).followerId) : null,
  };
}

export async function listFollowers(userId, { limit = 20, cursor = null }) {
  const take = limit;
  const rows = await prisma.follow.findMany({
    where: { followingId: userId, ...createdAtKeyset(cursor, "followerId") },
    take: take + 1,
    orderBy: [{ createdAt: "desc" }, { followerId: "desc" }],
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
    nextCursor: hasMore
      ? encodeConnectionCursor(items.at(-1).createdAt, items.at(-1).followerId)
      : null,
  };
}

export async function listFollowing(userId, { limit = 20, cursor = null }) {
  const take = limit;
  const rows = await prisma.follow.findMany({
    where: { followerId: userId, ...createdAtKeyset(cursor, "followingId") },
    take: take + 1,
    orderBy: [{ createdAt: "desc" }, { followingId: "desc" }],
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
    nextCursor: hasMore
      ? encodeConnectionCursor(items.at(-1).createdAt, items.at(-1).followingId)
      : null,
  };
}
