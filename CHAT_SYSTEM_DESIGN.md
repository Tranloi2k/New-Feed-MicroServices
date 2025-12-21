# 💬 Chat System Design Document

## 📋 Overview

Thiết kế hệ thống chat real-time cho NewFeed platform, tích hợp với kiến trúc microservices hiện tại.

**Mục tiêu:**
- Real-time messaging giữa users
- Support 1-on-1 chat và group chat
- Scalable và reliable
- Tích hợp với hệ thống hiện tại (Auth, Notification)

---

## 🏗️ Architecture

```
┌─────────────┐
│   Client    │ (Web / Mobile)
└──────┬──────┘
       │  HTTP / WebSocket
       ▼
┌──────────────────────────────────────────────────────┐
│                 API Gateway :8080                   │
│  - Proxy /api/chat → Chat Service                   │
│  - Proxy /chat/socket.io → Chat Service (WebSocket) │
└─────────┬───────────────────────────────────────────┘
          │
          ▼
┌──────────────────────────────────────────────────────┐
│              Chat Service :3006                     │
│  - REST API (GraphQL optional)                      │
│  - Socket.IO for real-time messaging                │
│  - Message persistence                               │
│  - Online status management                          │
└──────┬───────────────────────────────────────────────┘
       │
       ├──────────────────┬──────────────────┐
       ▼                  ▼                  ▼
┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│ PostgreSQL  │    │    Redis    │    │  RabbitMQ   │
│  chat_db    │    │  (DB 4)     │    │  Events     │
│             │    │  - Online   │    │  - New msg  │
│ - Messages  │    │    status   │    │  - Typing   │
│ - Convs     │    │  - Recent   │    │             │
│ - Members   │    │    msgs     │    │             │
└─────────────┘    └─────────────┘    └─────────────┘
       │
       ▼
┌─────────────┐
│ Auth Service│ (Verify users, get user info)
└─────────────┘
```

---

## 📦 Components

### 1. **Chat Service** (New Microservice)

**Port:** 3006  
**Technology:** Node.js, Express, Socket.IO, Prisma, PostgreSQL

**Responsibilities:**
- Message CRUD operations
- Conversation management
- Real-time messaging via Socket.IO
- Online status tracking
- Message delivery status (sent, delivered, read)

**Endpoints:**
- `POST /api/conversations` - Create conversation
- `GET /api/conversations` - Get user conversations
- `GET /api/conversations/:id` - Get conversation details
- `GET /api/conversations/:id/messages` - Get messages (paginated)
- `POST /api/conversations/:id/messages` - Send message
- `PUT /api/messages/:id/read` - Mark as read
- `GET /api/users/:id/online` - Check online status

**WebSocket Events:**
- `connect` - Client connects
- `join-conversation` - Join conversation room
- `leave-conversation` - Leave conversation room
- `send-message` - Send message
- `typing` - User is typing
- `stop-typing` - User stopped typing
- `mark-read` - Mark message as read
- `new-message` - New message received
- `message-delivered` - Message delivered
- `message-read` - Message read
- `user-online` - User came online
- `user-offline` - User went offline

---

## 🗄️ Database Schema

### PostgreSQL (chat_db)

```prisma
// Conversation (1-on-1 or Group)
model Conversation {
  id            String    @id @default(uuid())
  type          ConversationType @default(ONE_ON_ONE) // ONE_ON_ONE, GROUP
  name          String?   // Group name (null for 1-on-1)
  avatarUrl     String?   // Group avatar
  createdBy     Int       // User ID
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
  lastMessageAt DateTime? // For sorting conversations
  
  members       ConversationMember[]
  messages      Message[]
  
  @@index([createdBy])
  @@index([lastMessageAt])
}

enum ConversationType {
  ONE_ON_ONE
  GROUP
}

// Conversation Members
model ConversationMember {
  id             String   @id @default(uuid())
  conversationId String
  userId         Int
  role           MemberRole @default(MEMBER) // MEMBER, ADMIN
  joinedAt       DateTime  @default(now())
  leftAt         DateTime? // Null if still in conversation
  lastReadAt     DateTime? // Last time user read messages
  
  conversation   Conversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  
  @@unique([conversationId, userId])
  @@index([userId])
  @@index([conversationId])
}

enum MemberRole {
  MEMBER
  ADMIN
}

// Messages
model Message {
  id             String   @id @default(uuid())
  conversationId String
  senderId       Int
  content        String
  messageType    MessageType @default(TEXT) // TEXT, IMAGE, VIDEO, FILE
  mediaUrl       String?  // For media messages
  replyToId      String?  // Reply to another message
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
  deletedAt      DateTime? // Soft delete
  
  conversation   Conversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  replyTo        Message?    @relation("MessageReplies", fields: [replyToId], references: [id])
  replies        Message[]   @relation("MessageReplies")
  deliveries     MessageDelivery[]
  
  @@index([conversationId, createdAt])
  @@index([senderId])
  @@index([replyToId])
}

enum MessageType {
  TEXT
  IMAGE
  VIDEO
  FILE
  SYSTEM // System messages (user joined, left, etc.)
}

// Message Delivery Status
model MessageDelivery {
  id        String   @id @default(uuid())
  messageId String
  userId    Int      // Recipient user ID
  status    DeliveryStatus @default(SENT) // SENT, DELIVERED, READ
  deliveredAt DateTime?
  readAt    DateTime?
  
  message   Message  @relation(fields: [messageId], references: [id], onDelete: Cascade)
  
  @@unique([messageId, userId])
  @@index([userId, status])
}

enum DeliveryStatus {
  SENT
  DELIVERED
  READ
}
```

---

## 🔄 Data Flow

### 1. **Send Message Flow**

```
Client → API Gateway → Chat Service (REST)
    ↓
Chat Service:
  1. Validate user (via Auth Service)
  2. Check conversation membership
  3. Save message to DB
  4. Create delivery records
  5. Publish to RabbitMQ: message.created
    ↓
Chat Service (Socket.IO):
  6. Emit to conversation room: new-message
  7. Update online users' delivery status
    ↓
Notification Service (via RabbitMQ):
  8. Send push notification to offline users
    ↓
Client receives:
  - Real-time message (if online)
  - Push notification (if offline)
```

### 2. **Real-time Message Delivery**

```
User A sends message
    ↓
Chat Service saves to DB
    ↓
Socket.IO emits to conversation room
    ↓
User B (online) receives: new-message event
    ↓
User B's client acknowledges
    ↓
Chat Service updates: DELIVERED
    ↓
User B reads message
    ↓
Chat Service updates: READ
    ↓
User A receives: message-read event
```

### 3. **Online Status Flow**

```
User connects to Socket.IO
    ↓
Chat Service:
  1. Store in Redis: online:{userId} = socketId (TTL: 5min)
  2. Emit to user's conversations: user-online
    ↓
User disconnects
    ↓
Chat Service:
  1. Remove from Redis
  2. Emit to user's conversations: user-offline
```

---

## 🔌 API Design

### REST API

#### Create Conversation

```http
POST /api/conversations
Authorization: Bearer <token>
Content-Type: application/json

{
  "type": "ONE_ON_ONE" | "GROUP",
  "memberIds": [2, 3],  // Other user IDs (for 1-on-1: 1 user, for group: multiple)
  "name": "Team Chat"   // Optional, only for GROUP
}

Response:
{
  "success": true,
  "conversation": {
    "id": "uuid",
    "type": "ONE_ON_ONE",
    "members": [...],
    "createdAt": "2025-12-17T..."
  }
}
```

#### Get Conversations

```http
GET /api/conversations?limit=20&cursor=...
Authorization: Bearer <token>

Response:
{
  "success": true,
  "conversations": [
    {
      "id": "uuid",
      "type": "ONE_ON_ONE",
      "lastMessage": {
        "id": "uuid",
        "content": "Hello!",
        "senderId": 2,
        "createdAt": "2025-12-17T..."
      },
      "unreadCount": 5,
      "members": [...]
    }
  ],
  "pageInfo": {
    "hasNextPage": true,
    "endCursor": "..."
  }
}
```

#### Get Messages

```http
GET /api/conversations/:id/messages?limit=50&cursor=...
Authorization: Bearer <token>

Response:
{
  "success": true,
  "messages": [
    {
      "id": "uuid",
      "senderId": 1,
      "content": "Hello!",
      "messageType": "TEXT",
      "createdAt": "2025-12-17T...",
      "deliveryStatus": {
        "sent": true,
        "delivered": true,
        "read": false
      }
    }
  ],
  "pageInfo": {
    "hasNextPage": false,
    "endCursor": "..."
  }
}
```

#### Send Message

```http
POST /api/conversations/:id/messages
Authorization: Bearer <token>
Content-Type: application/json

{
  "content": "Hello!",
  "messageType": "TEXT",
  "replyToId": "uuid"  // Optional
}

Response:
{
  "success": true,
  "message": {
    "id": "uuid",
    "content": "Hello!",
    "senderId": 1,
    "createdAt": "2025-12-17T..."
  }
}
```

#### Mark as Read

```http
PUT /api/messages/:id/read
Authorization: Bearer <token>

Response:
{
  "success": true,
  "message": "Message marked as read"
}
```

---

## 🔌 WebSocket API (Socket.IO)

### Connection

```javascript
import { io } from "socket.io-client";

const socket = io("http://localhost:8080/chat/socket.io", {
  auth: {
    token: "jwt_token"  // JWT from Auth Service
  },
  withCredentials: true
});
```

### Client Events (Emit)

```javascript
// Join conversation
socket.emit("join-conversation", conversationId);

// Leave conversation
socket.emit("leave-conversation", conversationId);

// Send message
socket.emit("send-message", {
  conversationId: "uuid",
  content: "Hello!",
  messageType: "TEXT",
  replyToId: "uuid"  // Optional
});

// Typing indicator
socket.emit("typing", {
  conversationId: "uuid",
  isTyping: true
});

// Stop typing
socket.emit("stop-typing", {
  conversationId: "uuid"
});

// Mark message as read
socket.emit("mark-read", {
  messageId: "uuid",
  conversationId: "uuid"
});
```

### Server Events (Listen)

```javascript
// New message received
socket.on("new-message", (data) => {
  // data: {
  //   id: "uuid",
  //   conversationId: "uuid",
  //   senderId: 1,
  //   content: "Hello!",
  //   createdAt: "2025-12-17T..."
  // }
});

// Message delivered
socket.on("message-delivered", (data) => {
  // data: {
  //   messageId: "uuid",
  //   userId: 2,
  //   deliveredAt: "2025-12-17T..."
  // }
});

// Message read
socket.on("message-read", (data) => {
  // data: {
  //   messageId: "uuid",
  //   userId: 2,
  //   readAt: "2025-12-17T..."
  // }
});

// User online
socket.on("user-online", (data) => {
  // data: {
  //   userId: 2,
  //   conversationId: "uuid"
  // }
});

// User offline
socket.on("user-offline", (data) => {
  // data: {
  //   userId: 2,
  //   conversationId: "uuid"
  // }
});

// Typing indicator
socket.on("user-typing", (data) => {
  // data: {
  //   userId: 2,
  //   conversationId: "uuid",
  //   isTyping: true
  // }
});
```

---

## 🔄 Integration với Hệ Thống Hiện Tại

### 1. **Auth Service Integration**

```javascript
// Chat Service verifies JWT token
const verifyToken = async (token) => {
  const response = await axios.get(`${AUTH_SERVICE_URL}/api/verify`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  return response.data.user;
};

// Get user info for display
const getUserInfo = async (userId) => {
  const response = await axios.get(`${AUTH_SERVICE_URL}/api/users/${userId}`, {
    headers: { "X-Service-Token": SERVICE_SECRET }
  });
  return response.data;
};
```

### 2. **RabbitMQ Events**

**Publish Events:**
- `chat.message.created` - New message created
- `chat.message.read` - Message read
- `chat.conversation.created` - New conversation

**Subscribe Events:**
- `user.deleted` - Delete user's conversations (from Auth Service)
- `user.updated` - Update user info in conversations

### 3. **Notification Service Integration**

```javascript
// Publish to RabbitMQ when message created
await publishEvent("chat.message.created", {
  messageId: message.id,
  conversationId: message.conversationId,
  senderId: message.senderId,
  recipientIds: [...],  // Other members
  content: message.content,
  createdAt: message.createdAt
});

// Notification Service listens and sends push notifications
// to offline users
```

### 4. **Redis Usage**

**DB 4: Chat Service**
- `online:{userId}` - Online status (TTL: 5min)
- `typing:{conversationId}:{userId}` - Typing indicator (TTL: 3s)
- `conversation:{conversationId}:lastMessage` - Cache last message
- `user:{userId}:conversations` - Cache user's conversations (TTL: 5min)

---

## 📁 Project Structure

```
chat-service/
├── src/
│   ├── app.js                    # Express + Socket.IO server
│   ├── routes/
│   │   ├── conversationRoutes.js # REST routes
│   │   └── messageRoutes.js
│   ├── controllers/
│   │   ├── conversationController.js
│   │   └── messageController.js
│   ├── services/
│   │   ├── socketService.js      # Socket.IO handlers
│   │   ├── messageService.js
│   │   ├── conversationService.js
│   │   ├── onlineStatusService.js
│   │   └── eventPublisher.js     # RabbitMQ publisher
│   ├── middleware/
│   │   └── auth.js               # JWT verification
│   ├── config/
│   │   ├── database.js           # Prisma client
│   │   ├── redis.js
│   │   └── rabbitmq.js
│   └── utils/
│       └── logger.js
├── prisma/
│   └── schema.prisma
├── Dockerfile
└── package.json
```

---

## 🚀 Implementation Steps

### Phase 1: Basic Chat (MVP)

1. ✅ Create Chat Service structure
2. ✅ Database schema (Conversation, Message, Member)
3. ✅ REST API for conversations and messages
4. ✅ Socket.IO basic connection
5. ✅ Send/receive messages real-time
6. ✅ Integration with Auth Service

### Phase 2: Enhanced Features

1. ✅ Online status tracking
2. ✅ Message delivery status (sent, delivered, read)
3. ✅ Typing indicators
4. ✅ Message pagination
5. ✅ Unread count
6. ✅ Integration with Notification Service

### Phase 3: Advanced Features

1. ✅ Group chat support
2. ✅ Message replies
3. ✅ Media messages (images, files)
4. ✅ Message search
5. ✅ Message reactions
6. ✅ Conversation archiving

---

## 🔐 Security Considerations

### 1. **Authentication**
- All REST endpoints require JWT token
- Socket.IO connection requires JWT in auth
- Verify token with Auth Service

### 2. **Authorization**
- Users can only access conversations they're members of
- Users can only send messages to conversations they're in
- Group admins can manage members

### 3. **Rate Limiting**
- Message sending: 30 messages/minute per user
- Typing indicator: 10 events/minute per user
- Connection: 5 connections/minute per IP

### 4. **Input Validation**
- Message content: Max 5000 characters
- Media files: Max 10MB
- Conversation name: Max 100 characters

---

## 📊 Performance Considerations

### 1. **Database Optimization**
- Index on `conversationId, createdAt` for messages
- Index on `userId` for conversations
- Pagination with cursor-based approach
- Connection pooling (Prisma)

### 2. **Caching Strategy**
- Cache recent messages in Redis (last 50 messages per conversation)
- Cache online status in Redis
- Cache user conversations list (TTL: 5min)

### 3. **Scalability**
- Socket.IO with Redis adapter for horizontal scaling
- Multiple Chat Service instances
- Load balancer for WebSocket connections

### 4. **Message Delivery**
- Batch delivery status updates
- Async message persistence
- Background jobs for notifications

---

## 🧪 Testing Strategy

### Unit Tests
- Message service logic
- Conversation service logic
- Socket.IO event handlers

### Integration Tests
- REST API endpoints
- Database operations
- Auth Service integration

### E2E Tests
- Complete message flow
- Online/offline status
- Delivery status updates

### Load Tests
- Concurrent WebSocket connections
- Message throughput
- Database query performance

---

## 📈 Monitoring & Observability

### Metrics
- Active WebSocket connections
- Messages per second
- Average message delivery time
- Online users count
- Error rate

### Logging
- Message sent/received events
- Connection/disconnection events
- Error logs with context

### Health Checks
- `GET /health` - Service health
- Database connection status
- Redis connection status
- RabbitMQ connection status

---

## 🔄 Migration Plan

### Step 1: Setup
1. Create Chat Service repository
2. Setup database (PostgreSQL)
3. Run Prisma migrations
4. Deploy to Docker

### Step 2: Integration
1. Add Chat Service to docker-compose.yml
2. Update API Gateway routes
3. Configure RabbitMQ events
4. Setup Redis caching

### Step 3: Testing
1. Test REST API
2. Test WebSocket connections
3. Test integration with Auth Service
4. Load testing

### Step 4: Deployment
1. Deploy to staging
2. User acceptance testing
3. Deploy to production
4. Monitor and optimize

---

## 📝 API Gateway Updates

### New Routes

```javascript
// Chat Service REST API
app.use(
  "/api/chat",
  authenticateToken,
  createCircuitBreakerProxy("chat", SERVICES.chat),
  createProxyMiddleware({
    target: SERVICES.chat,
    pathRewrite: { "^/api/chat": "/api" }
  })
);

// Chat Service WebSocket
const chatWsProxy = createProxyMiddleware({
  target: SERVICES.chat,
  ws: true,
  pathRewrite: { "^/chat/socket.io": "/socket.io" }
});

app.use("/chat/socket.io", chatWsProxy);

httpServer.on('upgrade', (req, socket, head) => {
  if (req.url.startsWith('/chat/socket.io')) {
    chatWsProxy.upgrade(req, socket, head);
  }
});
```

---

## 🎯 Success Criteria

### Functional
- ✅ Users can send/receive messages in real-time
- ✅ Message delivery status works correctly
- ✅ Online status is accurate
- ✅ Typing indicators work
- ✅ Works with 1000+ concurrent users

### Performance
- ✅ Message delivery < 100ms (online users)
- ✅ API response time < 200ms (p95)
- ✅ Support 10,000+ concurrent connections
- ✅ Database queries optimized

### Reliability
- ✅ 99.9% uptime
- ✅ Message persistence guaranteed
- ✅ Graceful degradation when services down

---

## 📚 References

- Socket.IO Documentation: https://socket.io/docs/
- Prisma Documentation: https://www.prisma.io/docs/
- RabbitMQ Best Practices: https://www.rabbitmq.com/best-practices.html
- Redis Patterns: https://redis.io/docs/manual/patterns/

---

**Status:** 📋 **DESIGN COMPLETE** - Ready for implementation

