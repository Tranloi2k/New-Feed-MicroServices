import express from "express";
import { getMessages } from "../controllers/messageController.js";

const router = express.Router({ mergeParams: true });
router.get("/", getMessages);
export default router;
