import prisma from "../lib/prisma.js";
import {
  getFollowCounts,
  isFollowing,
  followUser,
  unfollowUser,
  listFollowers,
  listFollowing,
  getFollowingIds,
  getFollowerIds,
  hasPendingFollowRequest,
  canViewConnections,
  listFollowRequests,
  acceptFollowRequest,
  rejectFollowRequest,
} from "../services/followService.js";
import { invalidateUser } from "../services/cacheService.js";
import { logger } from "../utils/logger.js";
import {
  optionalHttpUrl,
  optionalText,
  pagination,
  positiveInteger,
} from "../utils/validation.js";

function publicUserSelect() {
  return {
    id: true,
    username: true,
    fullName: true,
    avatarUrl: true,
    bio: true,
    isPrivate: true,
    createdAt: true,
  };
}

async function buildProfile(user, viewerId) {
  const counts = await getFollowCounts(user.id);
  const following =
    viewerId != null ? await isFollowing(viewerId, user.id) : false;
  const isOwnProfile = viewerId != null && viewerId === user.id;
  const followRequested =
    viewerId != null && !isOwnProfile && !following
      ? await hasPendingFollowRequest(viewerId, user.id)
      : false;

  return {
    ...user,
    createdAt: user.createdAt?.toISOString?.() ?? user.createdAt,
    followersCount: counts.followersCount,
    followingCount: counts.followingCount,
    isFollowing: following,
    isOwnProfile,
    followRequested,
  };
}

export async function getProfileByUsername(req, res) {
  try {
    const username = (req.params.username || "").trim().toLowerCase();
    if (!username) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    let user = await prisma.user.findUnique({
      where: { username },
      select: publicUserSelect(),
    });

    if (!user && username.includes(" ")) {
      user = await prisma.user.findFirst({
        where: {
          OR: [
            { username: { equals: username, mode: "insensitive" } },
            { fullName: { equals: username, mode: "insensitive" } },
          ],
        },
        select: publicUserSelect(),
      });
    }

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const profile = await buildProfile(user, req.viewerId);
    res.json({ success: true, data: profile });
  } catch (error) {
    logger.error("profile.username_lookup_failed", { error, username: req.params.username });
    res.status(500).json({
      success: false,
      message: "Failed to load profile",
    });
  }
}

export async function getProfileById(req, res) {
  try {
    const parsedId = positiveInteger(req.params.id, "userId");
    if (parsedId.error) return res.status(400).json({ success: false, message: parsedId.error });
    const userId = parsedId.value;
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: publicUserSelect(),
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const profile = await buildProfile(user, req.viewerId);
    res.json({ success: true, data: profile });
  } catch (error) {
    logger.error("profile.id_lookup_failed", { error, userId: req.params.id });
    res.status(500).json({
      success: false,
      message: "Failed to load profile",
    });
  }
}

export async function updateMyProfile(req, res) {
  try {
    const { fullName, bio, avatarUrl, isPrivate } = req.body;
    const values = {
      fullName: optionalText(fullName, { field: "fullName", maxLength: 100 }),
      bio: optionalText(bio, { field: "bio", maxLength: 500 }),
      avatarUrl: optionalHttpUrl(avatarUrl),
    };
    const validationError = Object.values(values).find((value) => value.error)?.error;
    if (validationError) {
      return res.status(400).json({ success: false, message: validationError });
    }
    if (isPrivate !== undefined && typeof isPrivate !== "boolean") {
      return res.status(400).json({ success: false, message: "isPrivate must be a boolean" });
    }
    const user = await prisma.user.update({
      where: { id: req.user.userId },
      data: {
        ...(values.fullName.present && { fullName: values.fullName.value }),
        ...(values.bio.present && { bio: values.bio.value }),
        ...(values.avatarUrl.present && { avatarUrl: values.avatarUrl.value }),
        ...(isPrivate !== undefined && { isPrivate }),
      },
      select: publicUserSelect(),
    });

    await invalidateUser(req.user.userId);

    const profile = await buildProfile(user, req.user.userId);
    res.json({
      success: true,
      message: "Profile updated",
      data: profile,
    });
  } catch (error) {
    logger.error("profile.update_failed", { error, userId: req.user?.userId });
    res.status(500).json({
      success: false,
      message: "Failed to update profile",
    });
  }
}

export async function followUserHandler(req, res) {
  try {
    const parsedId = positiveInteger(req.params.id, "userId");
    if (parsedId.error) return res.status(400).json({ success: false, message: parsedId.error });
    const targetId = parsedId.value;
    const result = await followUser(req.user.userId, targetId);

    res.json({
      success: true,
      message: result.followRequested ? "Follow request sent" : "Followed successfully",
      data: result,
    });
  } catch (error) {
    const status = error.status || 500;
    res.status(status).json({
      success: false,
      message:
        status < 500 ? error.message : "Failed to follow user",
    });
  }
}

export async function unfollowUserHandler(req, res) {
  try {
    const parsedId = positiveInteger(req.params.id, "userId");
    if (parsedId.error) return res.status(400).json({ success: false, message: parsedId.error });
    const targetId = parsedId.value;
    await unfollowUser(req.user.userId, targetId);

    res.json({
      success: true,
      message: "Unfollowed successfully",
      data: { isFollowing: false, ...(await getFollowCounts(targetId)) },
    });
  } catch (error) {
    logger.error("follow.remove_failed", { error, userId: req.user?.userId });
    res.status(error.status || 500).json({
      success: false,
      message: error.status ? error.message : "Failed to unfollow user",
    });
  }
}

export async function getUserFollowers(req, res) {
  try {
    const parsedId = positiveInteger(req.params.id, "userId");
    const page = pagination(req.query);
    if (parsedId.error || page.error) return res.status(400).json({ success: false, message: parsedId.error || page.error });
    if (!(await canViewConnections(req.viewerId, parsedId.value))) {
      return res.status(403).json({ success: false, message: "This account is private" });
    }
    const result = await listFollowers(parsedId.value, page);
    res.json({ success: true, data: result });
  } catch (error) {
    logger.error("followers.lookup_failed", { error, userId: req.params.id });
    res.status(error.status || 500).json({
      success: false,
      message: error.status ? error.message : "Failed to load followers",
    });
  }
}

export async function getUserFollowing(req, res) {
  try {
    const parsedId = positiveInteger(req.params.id, "userId");
    const page = pagination(req.query);
    if (parsedId.error || page.error) return res.status(400).json({ success: false, message: parsedId.error || page.error });
    if (!(await canViewConnections(req.viewerId, parsedId.value))) {
      return res.status(403).json({ success: false, message: "This account is private" });
    }
    const result = await listFollowing(parsedId.value, page);
    res.json({ success: true, data: result });
  } catch (error) {
    logger.error("following.lookup_failed", { error, userId: req.params.id });
    res.status(error.status || 500).json({
      success: false,
      message: error.status ? error.message : "Failed to load following",
    });
  }
}

export async function getFollowingIdsInternal(req, res) {
  try {
    const parsedId = positiveInteger(req.params.id, "userId");
    if (parsedId.error) return res.status(400).json({ success: false, message: parsedId.error });
    const userId = parsedId.value;
    const page = internalPage(req.query);
    if (page.error) return res.status(400).json({ success: false, message: page.error });
    res.json({ success: true, data: await getFollowingIds(userId, page) });
  } catch (error) {
    logger.error("following_ids.lookup_failed", { error, userId: req.params.id });
    res.status(500).json({
      success: false,
      message: "Failed to load following ids",
    });
  }
}

export async function getMyFollowRequests(req, res) {
  try {
    const page = pagination(req.query);
    if (page.error) return res.status(400).json({ success: false, message: page.error });
    res.json({ success: true, data: await listFollowRequests(req.user.userId, page) });
  } catch (error) {
    logger.error("follow_requests.lookup_failed", { error, userId: req.user?.userId });
    res.status(error.status || 500).json({
      success: false,
      message: error.status ? error.message : "Failed to load follow requests",
    });
  }
}

async function resolveFollowRequest(req, res, action) {
  try {
    const parsedId = positiveInteger(req.params.id, "followerId");
    if (parsedId.error) return res.status(400).json({ success: false, message: parsedId.error });
    const data = await action(req.user.userId, parsedId.value);
    return res.json({ success: true, data: data || null });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ success: false, message: error.status ? error.message : "Failed to update follow request" });
  }
}

export function acceptFollowRequestHandler(req, res) {
  return resolveFollowRequest(req, res, acceptFollowRequest);
}

export function rejectFollowRequestHandler(req, res) {
  return resolveFollowRequest(req, res, rejectFollowRequest);
}

export async function getFollowerIdsInternal(req, res) {
  try {
    const parsedId = positiveInteger(req.params.id, "userId");
    if (parsedId.error) return res.status(400).json({ success: false, message: parsedId.error });
    const userId = parsedId.value;
    const page = internalPage(req.query);
    if (page.error) return res.status(400).json({ success: false, message: page.error });
    res.json({ success: true, data: await getFollowerIds(userId, page) });
  } catch (error) {
    logger.error("follower_ids.lookup_failed", { error, userId: req.params.id });
    res.status(500).json({
      success: false,
      message: "Failed to load follower ids",
    });
  }
}

function internalPage(query = {}) {
  const limit = query.limit === undefined ? 500 : Number(query.limit);
  const cursor = query.cursor === undefined ? 0 : Number(query.cursor);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
    return { error: "limit must be an integer between 1 and 500" };
  }
  if (!Number.isSafeInteger(cursor) || cursor < 0) {
    return { error: "cursor must be a non-negative integer" };
  }
  return { limit, cursor };
}
