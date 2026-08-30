import express from "express";
import upload, { MAX_FILES } from "../middleware/upload.js";
import avatarUpload from "../middleware/avatarUpload.js";
import { uploadMedia } from "../controllers/uploadController.js";
import { uploadAvatar } from "../controllers/avatarUploadController.js";

const router = express.Router();

/**
 * Upload media files (images/videos)
 * Route: POST /api/media/upload
 * Body: multipart/form-data with field "media" (array of files, max 4 × 8MB)
 */
router.post("/upload", upload.array("media", MAX_FILES), uploadMedia);

/** Avatar — single image, max 2MB, field name "avatar" */
router.post("/upload/avatar", avatarUpload.single("avatar"), uploadAvatar);

export default router;
