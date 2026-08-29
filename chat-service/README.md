# Chat service

Stateful realtime chat service on port 3006. It owns conversation/message data, uses the shared Redis for Socket.IO fan-out and ephemeral state, and publishes `chat.message.created` through the shared RabbitMQ exchange.

## Local development

Copy `.env.example` to `.env`, start PostgreSQL/Redis/RabbitMQ, then run:

```sh
npm install
npx prisma migrate dev
npm run dev
```

REST is served below `/api/chat`; Socket.IO uses the deliberately distinct `/chat/socket.io` path. Clients therefore keep two WebSocket connections: chat and notifications scale differently and remain separate responsibilities.

## Per-user rate limits

Rate limits use atomic Redis sliding windows keyed by authenticated `userId`, so they are shared by every chat-service replica:

- Create conversation: 10 requests/minute.
- Message history: 60 requests/minute.
- Delta sync: 60 requests/minute.
- `message:send`: 30 events/10 seconds and 300 events/5 minutes.
- Typing events: 10 events/10 seconds.
- `presence:ping`: 1 event/20 seconds.

REST requests receive `429`, `Retry-After`, and a `RATE_LIMIT_EXCEEDED` body. Socket clients receive `rate_limit:error`; limited message sends also receive `message:error` with `retryAfter` so the offline queue can retry without disconnecting. If Redis becomes temporarily unavailable, limits fail open to preserve chat availability.

## Delivery and sync guarantees

- The client creates a UUID `clientMessageId` and retries queued messages sequentially. The database unique constraint makes retry idempotent; only a newly committed message is broadcast or counted unread.
- Message IDs are server-generated ULIDs and all timestamps are server-generated. Reconnect uses `/api/chat/sync?since=...`, then fetches only the open conversation with `?after=<lastMessageId>`.
- Read state is a per-member high-water pointer. This is much cheaper than one receipt row per message/member, but intentionally does not preserve the exact time every member read every message.
- End-to-end encryption is out of scope: it would require key identity, rotation, multi-device recovery, encrypted media, and moderation/recovery product decisions rather than a partial server-only implementation.

For multiple replicas, the Redis adapter carries room events between pods and the Kubernetes Service uses `sessionAffinity: ClientIP` so Socket.IO polling/upgrade requests reach the same pod.
