import express from "express";
import upload from "../middleware/upload.js";
import { uploadMedia } from "../controllers/uploadController.js";

const router = express.Router();

/**
 * Upload media files (images/videos)
 * Route: POST /api/media/upload
 * Body: multipart/form-data with field "media" (array of files, max 10)
 */
router.post("/upload", upload.array("media", 10), uploadMedia);

export default router;
