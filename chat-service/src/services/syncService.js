import prisma from "../lib/prisma.js";
import { getUnreadMap } from "./unreadService.js";

export async function syncConversations(userId, since, db = prisma) {
  const sinceDate = new Date(since);
  if (!since || Number.isNaN(sinceDate.getTime())) {
    throw Object.assign(new Error("since must be a valid ISO timestamp"), { status: 400 });
  }
  const syncedAt = new Date();
  const conversations = await db.conversation.findMany({
    where: {
      members: { some: { userId, leftAt: null } },
      OR: [{ updatedAt: { gt: sinceDate } }, { lastMessageAt: { gt: sinceDate } }],
    },
    orderBy: { lastMessageAt: "desc" },
    select: {
      id: true,
      lastMessageAt: true,
      messages: { where: { deletedAt: null }, orderBy: { id: "desc" }, take: 1, select: { id: true } },
    },
  });
  const unread = await getUnreadMap(userId, conversations.map(({ id }) => id), db);
  return {
    conversations: conversations.map(({ messages, ...item }) => ({
      ...item,
      unreadCount: unread.get(item.id) || 0,
      lastMessageId: messages[0]?.id || null,
    })),
    syncedAt: syncedAt.toISOString(),
  };
}
