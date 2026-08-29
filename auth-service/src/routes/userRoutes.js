import express from "express";
import {
  getProfileByUsername,
  getProfileById,
  updateMyProfile,
  followUserHandler,
  unfollowUserHandler,
  getUserFollowers,
  getUserFollowing,
  getFollowingIdsInternal,
  getFollowerIdsInternal,
  getMyFollowRequests,
  acceptFollowRequestHandler,
  rejectFollowRequestHandler,
  searchUsers,
} from "../controllers/profileController.js";
import { requireUser, optionalViewer } from "../middleware/requireUser.js";
import { requireServiceAuth } from "../middleware/serviceAuth.js";

const router = express.Router();

router.patch("/me/profile", requireUser, updateMyProfile);
router.get("/me/follow-requests", requireUser, getMyFollowRequests);
router.post("/me/follow-requests/:id/accept", requireUser, acceptFollowRequestHandler);
router.delete("/me/follow-requests/:id", requireUser, rejectFollowRequestHandler);
router.get("/search", requireUser, searchUsers);
router.get("/username/:username", optionalViewer, getProfileByUsername);
router.get("/:id/profile", optionalViewer, getProfileById);
router.get("/:id/followers", optionalViewer, getUserFollowers);
router.get("/:id/following", optionalViewer, getUserFollowing);
router.post("/:id/follow", requireUser, followUserHandler);
router.delete("/:id/follow", requireUser, unfollowUserHandler);

router.get(
  "/internal/:id/following-ids",
  requireServiceAuth,
  getFollowingIdsInternal
);
router.get(
  "/internal/:id/follower-ids",
  requireServiceAuth,
  getFollowerIdsInternal
);

export default router;
