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
} from "../controllers/profileController.js";
import { requireUser, optionalViewer } from "../middleware/requireUser.js";

function authenticateService(req, res, next) {
  const token = req.headers["x-service-token"];
  if (!token || token !== process.env.SERVICE_SECRET) {
    return res.status(403).json({
      success: false,
      message: "Unauthorized service call",
    });
  }
  next();
}

const router = express.Router();

router.patch("/me/profile", requireUser, updateMyProfile);
router.get("/username/:username", optionalViewer, getProfileByUsername);
router.get("/:id/profile", optionalViewer, getProfileById);
router.get("/:id/followers", optionalViewer, getUserFollowers);
router.get("/:id/following", optionalViewer, getUserFollowing);
router.post("/:id/follow", requireUser, followUserHandler);
router.delete("/:id/follow", requireUser, unfollowUserHandler);

router.get(
  "/internal/:id/following-ids",
  authenticateService,
  getFollowingIdsInternal
);

export default router;
