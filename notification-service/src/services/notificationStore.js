import prisma from "../lib/prisma.js";

export async function createNotification({
  userId,
  type,
  message,
  data = null,
}, db = prisma) {
  const notification = await db.notification.create({
    data: {
      userId,
      type,
      message,
      data: data ?? undefined,
    },
  });

  return formatNotification(notification);
}

export async function listNotifications(userId, { limit = 20, cursor } = {}) {
  const take = Math.min(Math.max(limit, 1), 50);

  const notifications = await prisma.notification.findMany({
    where: { userId },
    take: take + 1,
    ...(cursor && {
      cursor: { id: cursor },
      skip: 1,
    }),
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });

  const hasMore = notifications.length > take;
  const items = hasMore ? notifications.slice(0, take) : notifications;

  return {
    notifications: items.map(formatNotification),
    hasMore,
    nextCursor: hasMore ? items[items.length - 1].id : null,
  };
}

export async function markNotificationRead(userId, notificationId) {
  const result = await prisma.notification.updateMany({
    where: { id: notificationId, userId },
    data: { read: true },
  });
  return result.count > 0;
}

export async function markAllNotificationsRead(userId) {
  await prisma.notification.updateMany({
    where: { userId, read: false },
    data: { read: true },
  });
}

export async function getUnreadCount(userId) {
  return prisma.notification.count({
    where: { userId, read: false },
  });
}

function formatNotification(row) {
  return {
    id: row.id,
    userId: row.userId,
    type: row.type,
    message: row.message,
    data: row.data,
    read: row.read,
    createdAt: row.createdAt.toISOString(),
  };
}
