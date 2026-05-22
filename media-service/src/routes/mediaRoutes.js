import express from "express";
import upload from "../middleware/upload.js";
import avatarUpload from "../middleware/avatarUpload.js";
import { uploadMedia } from "../controllers/uploadController.js";
import { uploadAvatar } from "../controllers/avatarUploadController.js";

const router = express.Router();

/**
 * Upload media files (images/videos)
 * Route: POST /api/media/upload
 * Body: multipart/form-data with field "media" (array of files, max 10)
 */
router.post("/upload", upload.array("media", 10), uploadMedia);

/** Avatar — single image, max 2MB, field name "avatar" */
router.post("/upload/avatar", avatarUpload.single("avatar"), uploadAvatar);

export default router;
