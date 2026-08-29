import prisma from "../lib/prisma.js";
import { createConversation, listConversations, assertMember } from "../services/conversationService.js";
import { resetUnread } from "../services/unreadService.js";

export function conversationController(io) {
  return {
    list: async (req, res, next) => {
      try {
        const data = await listConversations(req.user.userId, req.query);
        res.json({ success: true, data });
      } catch (error) { next(error); }
    },
    create: async (req, res, next) => {
      try {
        const data = await createConversation(req.user.userId, req.body);
        for (const member of data.members) io.in(`user:${member.userId}`).socketsJoin(`conversation:${data.id}`);
        res.status(201).json({ success: true, data });
      } catch (error) { next(error); }
    },
    read: async (req, res, next) => {
      try {
        const userId = req.user.userId;
        const conversationId = req.params.id;
        const messageId = String(req.body?.lastReadMessageId || "");
        const member = await assertMember(conversationId, userId);
        const message = await prisma.message.findFirst({ where: { id: messageId, conversationId, deletedAt: null } });
        if (!message) return res.status(400).json({ success: false, message: "Message does not belong to this conversation" });
        const lastReadMessageId = member.lastReadMessageId && member.lastReadMessageId > messageId
          ? member.lastReadMessageId
          : messageId;
        await prisma.$transaction([
          prisma.conversationMember.update({
            where: { conversationId_userId: { conversationId, userId } },
            data: { lastReadMessageId },
          }),
          // Make an offline device's next delta sync observe this read-pointer change.
          prisma.conversation.update({
            where: { id: conversationId },
            data: { updatedAt: new Date() },
          }),
        ]);
        await resetUnread(userId, conversationId);
        const payload = { conversationId, lastReadMessageId, userId };
        io.to(`user:${userId}`).emit("read:updated", payload);
        io.to(`conversation:${conversationId}`).emit("read:updated", payload);
        res.json({ success: true, data: payload });
      } catch (error) { next(error); }
    },
  };
}
