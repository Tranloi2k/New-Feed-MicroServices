import {
  listNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  getUnreadCount,
} from "../services/notificationStore.js";

export async function getNotifications(req, res) {
  try {
    const limit = parseInt(req.query.limit, 10) || 20;
    const cursor = req.query.cursor || undefined;
    const result = await listNotifications(req.user.userId, { limit, cursor });

    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error("Get notifications error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch notifications",
    });
  }
}

export async function getUnreadCountHandler(req, res) {
  try {
    const count = await getUnreadCount(req.user.userId);
    res.json({
      success: true,
      data: { count },
    });
  } catch (error) {
    console.error("Get unread count error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch unread count",
    });
  }
}

export async function markRead(req, res) {
  try {
    const updated = await markNotificationRead(
      req.user.userId,
      req.params.id
    );

    if (!updated) {
      return res.status(404).json({
        success: false,
        message: "Notification not found",
      });
    }

    res.json({
      success: true,
      message: "Notification marked as read",
    });
  } catch (error) {
    console.error("Mark read error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to mark notification as read",
    });
  }
}

export async function markAllRead(req, res) {
  try {
    await markAllNotificationsRead(req.user.userId);
    res.json({
      success: true,
      message: "All notifications marked as read",
    });
  } catch (error) {
    console.error("Mark all read error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to mark notifications as read",
    });
  }
}
