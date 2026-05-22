import prisma from "../lib/prisma.js";
import {
  getFollowCounts,
  isFollowing,
  followUser,
  unfollowUser,
  listFollowers,
  listFollowing,
  getFollowingIds,
} from "../services/followService.js";
import { invalidateUser } from "../services/cacheService.js";

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

  return {
    ...user,
    createdAt: user.createdAt?.toISOString?.() ?? user.createdAt,
    followersCount: counts.followersCount,
    followingCount: counts.followingCount,
    isFollowing: following,
    isOwnProfile,
  };
}

export async function getProfileByUsername(req, res) {
  try {
    const username = decodeURIComponent(req.params.username || "").trim();
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
    console.error("Get profile by username error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to load profile",
    });
  }
}

export async function getProfileById(req, res) {
  try {
    const userId = parseInt(req.params.id, 10);
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
    console.error("Get profile by id error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to load profile",
    });
  }
}

export async function updateMyProfile(req, res) {
  try {
    const { fullName, bio, avatarUrl } = req.body;
    const user = await prisma.user.update({
      where: { id: req.user.userId },
      data: {
        ...(fullName !== undefined && { fullName: fullName?.trim() || null }),
        ...(bio !== undefined && { bio: bio?.trim() || null }),
        ...(avatarUrl !== undefined && { avatarUrl: avatarUrl || null }),
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
    console.error("Update profile error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update profile",
    });
  }
}

export async function followUserHandler(req, res) {
  try {
    const targetId = parseInt(req.params.id, 10);
    await followUser(req.user.userId, targetId);
    const following = true;
    const counts = await getFollowCounts(targetId);

    res.json({
      success: true,
      message: "Followed successfully",
      data: { isFollowing: following, ...counts },
    });
  } catch (error) {
    const status =
      error.message === "User not found"
        ? 404
        : error.message === "Cannot follow yourself"
          ? 400
          : 500;
    res.status(status).json({
      success: false,
      message: error.message || "Failed to follow user",
    });
  }
}

export async function unfollowUserHandler(req, res) {
  try {
    const targetId = parseInt(req.params.id, 10);
    await unfollowUser(req.user.userId, targetId);

    res.json({
      success: true,
      message: "Unfollowed successfully",
      data: { isFollowing: false, ...(await getFollowCounts(targetId)) },
    });
  } catch (error) {
    console.error("Unfollow error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to unfollow user",
    });
  }
}

export async function getUserFollowers(req, res) {
  try {
    const userId = parseInt(req.params.id, 10);
    const limit = parseInt(req.query.limit, 10) || 20;
    const cursor = req.query.cursor ? parseInt(req.query.cursor, 10) : undefined;
    const result = await listFollowers(userId, { limit, cursor });
    res.json({ success: true, data: result });
  } catch (error) {
    console.error("Get followers error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to load followers",
    });
  }
}

export async function getUserFollowing(req, res) {
  try {
    const userId = parseInt(req.params.id, 10);
    const limit = parseInt(req.query.limit, 10) || 20;
    const cursor = req.query.cursor ? parseInt(req.query.cursor, 10) : undefined;
    const result = await listFollowing(userId, { limit, cursor });
    res.json({ success: true, data: result });
  } catch (error) {
    console.error("Get following error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to load following",
    });
  }
}

export async function getFollowingIdsInternal(req, res) {
  try {
    const userId = parseInt(req.params.id, 10);
    const ids = await getFollowingIds(userId);
    res.json({ success: true, data: { ids } });
  } catch (error) {
    console.error("Get following ids error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to load following ids",
    });
  }
}
