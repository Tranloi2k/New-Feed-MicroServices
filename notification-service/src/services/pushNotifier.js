import { deleteTokens, listTokensForUsers } from "./deviceTokenStore.js";
import { sendPushToTokens } from "./pushSender.js";

const PREVIEW_LENGTH = 120;

function chatMessage(data) {
  return {
    notification: {
      title: data.senderName || "Tin nhắn mới",
      body: String(data.preview || "").slice(0, PREVIEW_LENGTH),
    },
    // FCM v1 requires every data value to be a string.
    data: {
      type: "chat",
      conversationId: String(data.conversationId),
      messageId: String(data.messageId),
    },
    android: {
      priority: "high",
      notification: { channelId: "default" },
    },
  };
}

/**
 * Pushes a chat message to the recipients the event listener already found to
 * be offline. Tokens FCM rejects as dead are pruned so the table stays honest.
 */
export async function pushChatMessage(
  data,
  { listTokens = listTokensForUsers, send = sendPushToTokens, prune = deleteTokens } = {}
) {
  const recipientIds = data?.offlineRecipientIds || [];
  if (!recipientIds.length) return { sent: 0, pruned: 0 };

  const tokens = await listTokens(recipientIds);
  if (!tokens.length) return { sent: 0, pruned: 0 };

  const { sent, deadTokens } = await send(tokens, chatMessage(data));
  const pruned = deadTokens.length ? await prune(deadTokens) : 0;
  return { sent, pruned };
}
