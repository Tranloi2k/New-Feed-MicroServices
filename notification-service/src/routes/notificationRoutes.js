import express from "express";
import {
  getNotifications,
  getUnreadCountHandler,
  markRead,
  markAllRead,
} from "../controllers/notificationController.js";
import { registerDevice, unregisterDevice } from "../controllers/deviceController.js";
import { requireUser } from "../middleware/httpAuth.js";

const router = express.Router();

router.use(requireUser);

router.get("/", getNotifications);
router.get("/unread-count", getUnreadCountHandler);
router.patch("/:id/read", markRead);
router.post("/read-all", markAllRead);
router.post("/devices", registerDevice);
router.delete("/devices", unregisterDevice);

export default router;
