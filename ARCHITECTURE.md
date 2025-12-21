# 🏗️ Kiến Trúc Hệ Thống Microservices

## 📊 Tổng Quan Kiến Trúc

Hệ thống được xây dựng theo mô hình **Microservices Architecture** với Event-Driven Communication và Distributed Caching.

```mermaid
graph TB
    Client[👤 Client Application]
    
    subgraph "API Layer"
        Gateway[🚪 API Gateway<br/>Port 3000<br/>Rate Limiting & Auth]
    end
    
    subgraph "Service Layer"
        Auth[🔐 Auth Service<br/>Port 3001<br/>JWT & User Management]
        Post[📝 Post Service<br/>Port 3002<br/>Posts & News Feed]
        Comment[💬 Comment Service<br/>Port 3003<br/>Comments & Replies]
        Media[🖼️ Media Service<br/>Port 3004<br/>File Upload]
        Notif[🔔 Notification Service<br/>Port 3005<br/>Real-time Alerts]
    end
    
    subgraph "Data Layer"
        AuthDB[(🗄️ Auth DB<br/>PostgreSQL)]
        PostDB[(🗄️ Post DB<br/>PostgreSQL)]
        CommentDB[(🗄️ Comment DB<br/>PostgreSQL)]
        
        Redis[⚡ Redis<br/>Multi-Database Cache]
        RabbitMQ[🐰 RabbitMQ<br/>Message Broker]
    end
    
    subgraph "External Services"
        Cloudinary[☁️ Cloudinary<br/>Media Storage]
    end
    
    Client -->|HTTP/GraphQL| Gateway
    
    Gateway -->|REST| Auth
    Gateway -->|GraphQL| Post
    Gateway -->|GraphQL| Comment
    Gateway -->|REST| Media
    
    Auth -->|Prisma ORM| AuthDB
    Post -->|Prisma ORM| PostDB
    Comment -->|Prisma ORM| CommentDB
    
    Auth -->|Cache<br/>DB 3| Redis
    Post -->|Cache<br/>DB 1| Redis
    Comment -->|Cache<br/>DB 2| Redis
    Gateway -->|Rate Limit<br/>DB 0| Redis
    
    Post -->|Publish Events| RabbitMQ
    Comment -->|Publish Events| RabbitMQ
    Notif -->|Subscribe Events| RabbitMQ
    
    Media -->|Upload| Cloudinary
    
    style Gateway fill:#ff6b6b
    style Auth fill:#4ecdc4
    style Post fill:#45b7d1
    style Comment fill:#96ceb4
    style Media fill:#ffeaa7
    style Notif fill:#dfe6e9
    style Redis fill:#e84393
    style RabbitMQ fill:#fd79a8
```

## 🔄 Flow Hoạt Động Chi Tiết

### 1️⃣ User Authentication Flow

```mermaid
sequenceDiagram
    participant C as Client
    participant G as API Gateway
    participant A as Auth Service
    participant R as Redis (DB 3)
    participant DB as Auth Database
    
    C->>G: POST /auth/signup
    G->>A: Forward request
    A->>DB: Check user exists
    A->>R: Cache user_exists check
    A->>DB: Create user
    A->>R: Cache user data (TTL: 30min)
    A->>C: Return JWT token
    
    Note over C,DB: Subsequent requests
    C->>G: Request with JWT
    G->>A: Validate token
    A->>R: Check cached user
    alt Cache Hit
        R-->>A: Return user data
    else Cache Miss
        A->>DB: Query user
        A->>R: Cache user data
    end
    A-->>G: User validated
    G-->>C: Authorized response
```

### 2️⃣ Post Creation & Caching Flow

```mermaid
sequenceDiagram
    participant C as Client
    participant G as API Gateway
    participant P as Post Service
    participant R as Redis (DB 1)
    participant DB as Post Database
    participant MQ as RabbitMQ
    
    C->>G: GraphQL: createPost
    G->>P: Forward mutation
    P->>DB: INSERT post
    P->>R: Invalidate cache<br/>Pattern: post:newsfeed:*
    P->>MQ: Publish post.created event
    P-->>C: Return created post
    
    Note over C,MQ: Reading news feed
    C->>G: GraphQL: getNewsFeed
    G->>P: Forward query
    P->>R: Check cached feed
    alt Cache Hit
        R-->>P: Return cached data
    else Cache Miss
        P->>DB: Query posts
        P->>R: Cache feed (TTL: 2min)
    end
    P-->>C: Return news feed
```

### 3️⃣ Comment Creation & Event Flow

```mermaid
sequenceDiagram
    participant C as Client
    participant G as API Gateway
    participant CM as Comment Service
    participant R as Redis (DB 2)
    participant DB as Comment Database
    participant MQ as RabbitMQ
    participant N as Notification Service
    
    C->>G: GraphQL: createComment
    G->>CM: Forward mutation
    CM->>DB: INSERT comment
    CM->>R: Invalidate post comments<br/>Pattern: comment:post:{id}:*
    alt Is Reply
        CM->>R: Invalidate parent comment
    end
    CM->>MQ: Publish comment.created
    CM-->>C: Return comment
    
    MQ->>N: Deliver event
    N->>N: Send notification to post author
```

### 4️⃣ Media Upload Flow

```mermaid
sequenceDiagram
    participant C as Client
    participant G as API Gateway
    participant M as Media Service
    participant CL as Cloudinary
    
    C->>G: POST /media/upload<br/>multipart/form-data
    G->>M: Forward file
    M->>M: Validate file<br/>(size, type)
    M->>CL: Upload to cloud
    CL-->>M: Return URL & metadata
    M-->>C: Return media URL
```

## 🗄️ Redis Database Allocation

| Database | Service | Purpose | Key Pattern | TTL |
|----------|---------|---------|-------------|-----|
| **DB 0** | API Gateway | Rate Limiting | `ratelimit:{ip}` | 60s |
| **DB 1** | Post Service | Post & Feed Cache | `post:newsfeed:*`<br/>`post:single:{id}` | 2-10min |
| **DB 2** | Comment Service | Comment Cache | `comment:post:{id}:*`<br/>`comment:single:{id}` | 2-10min |
| **DB 3** | Auth Service | User Cache | `auth:user:{id}`<br/>`auth:user_exists:*` | 5-30min |

## 🐰 RabbitMQ Event Patterns

### Published Events

| Service | Event Type | Payload | Subscribers |
|---------|------------|---------|-------------|
| **Post Service** | `post.created` | `{post, userId}` | Notification Service |
| **Comment Service** | `comment.created` | `{comment, postId, postAuthorId}` | Notification Service |

### Event Flow
```
Publisher → Exchange (topic) → Queue → Consumer
```

## 🔐 Authentication & Authorization

### JWT Flow
```mermaid
graph LR
    A[Client Login] -->|Username/Password| B[Auth Service]
    B -->|Generate JWT| C[Client Storage]
    C -->|Include in Header| D[API Gateway]
    D -->|Verify JWT| E[Auth Service]
    E -->|Valid| F[Access Granted]
    E -->|Invalid| G[401 Unauthorized]
```

### Middleware Chain
```
Request → Rate Limiter → JWT Validator → Service Handler
```

## 📦 Data Models

### User (Auth Service)
```prisma
model User {
  id        Int      @id @default(autoincrement())
  username  String   @unique
  email     String   @unique
  password  String
  name      String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

### Post (Post Service)
```prisma
model Post {
  id        Int      @id @default(autoincrement())
  content   String
  imageUrl  String?
  userId    Int
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

### Comment (Comment Service)
```prisma
model Comment {
  id              Int       @id @default(autoincrement())
  content         String
  postId          Int
  userId          Int
  parentCommentId Int?
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt
  
  replies         Comment[] @relation("CommentReplies")
  parent          Comment?  @relation("CommentReplies")
}
```

## 🚀 Deployment Architecture

```mermaid
graph TB
    subgraph "Docker Compose Environment"
        subgraph "Network: microservices_network"
            Gateway[API Gateway<br/>Container]
            Auth[Auth Service<br/>Container]
            Post[Post Service<br/>Container]
            Comment[Comment Service<br/>Container]
            Media[Media Service<br/>Container]
            Notif[Notification Service<br/>Container]
        end
        
        subgraph "Data Services"
            Redis[Redis<br/>Container<br/>Port 6379]
            RabbitMQ[RabbitMQ<br/>Container<br/>Port 5672, 15672]
            AuthDB[Auth PostgreSQL<br/>Container]
            PostDB[Post PostgreSQL<br/>Container]
            CommentDB[Comment PostgreSQL<br/>Container]
        end
    end
    
    Gateway --> Auth
    Gateway --> Post
    Gateway --> Comment
    Gateway --> Media
    
    Auth --> AuthDB
    Post --> PostDB
    Comment --> CommentDB
    
    Auth --> Redis
    Post --> Redis
    Comment --> Redis
    Gateway --> Redis
    
    Post --> RabbitMQ
    Comment --> RabbitMQ
    Notif --> RabbitMQ
```

## 🛡️ Security Layers

1. **API Gateway Level**
   - Rate Limiting (60 requests/min per IP)
   - JWT Validation
   - Request/Response logging

2. **Service Level**
   - JWT verification
   - Input validation
   - Error handling

3. **Database Level**
   - Connection pooling
   - Prepared statements (SQL injection prevention)
   - ORM validation (Prisma)

## 📈 Scalability Strategy

### Horizontal Scaling
- Each service can be scaled independently
- Stateless design (JWT, no sessions)
- Shared Redis for distributed caching

### Caching Strategy
- **Cache-Aside Pattern**: Check cache → Miss → DB → Update cache
- **TTL-based Expiration**: Auto-cleanup of stale data
- **Event-driven Invalidation**: Real-time cache updates

### Database Optimization
- Indexed fields: `userId`, `postId`, `createdAt`
- Connection pooling: 5 connections per service
- Read replicas (future enhancement)

## 🔧 Technology Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| **Runtime** | Node.js | 20.x |
| **API Gateway** | Express.js | 4.x |
| **GraphQL** | Apollo Server | 4.x |
| **Database** | PostgreSQL | 16.x |
| **Cache** | Redis | 7.x |
| **Message Broker** | RabbitMQ | 3.x |
| **ORM** | Prisma | 5.x |
| **Authentication** | JWT | jsonwebtoken |
| **Cloud Storage** | Cloudinary | - |
| **Containerization** | Docker | 24.x |

## 📝 Service Ports

| Service | Port | Protocol |
|---------|------|----------|
| API Gateway | 3000 | HTTP/REST |
| Auth Service | 3001 | HTTP/REST |
| Post Service | 3002 | HTTP/GraphQL |
| Comment Service | 3003 | HTTP/GraphQL |
| Media Service | 3004 | HTTP/REST |
| Notification Service | 3005 | HTTP/SSE |
| Redis | 6379 | Redis Protocol |
| RabbitMQ | 5672 | AMQP |
| RabbitMQ Management | 15672 | HTTP |

## 🎯 Design Patterns

1. **API Gateway Pattern**: Single entry point for all clients
2. **Database per Service**: Each service owns its data
3. **Event-Driven Architecture**: Async communication via RabbitMQ
4. **Cache-Aside Pattern**: Lazy loading with TTL
5. **Circuit Breaker**: Graceful degradation (future)
6. **Service Discovery**: Static configuration (Docker network)

## 🔄 Data Consistency

### Eventual Consistency
- Event publishing is asynchronous
- Cache invalidation may have slight delay
- Trade-off: Performance vs Immediate Consistency

### Cache Invalidation Strategies
```javascript
// Pattern-based invalidation
await redis.delPattern('comment:post:123:*');

// Single key invalidation
await redis.del('auth:user:456');

// Scan-based safe deletion (production)
const stream = redis.scanStream({
  match: 'comment:post:123:comments:*'
});
```

## 📚 Further Reading

- [Getting Started Guide](GETTING_STARTED.md)
- [API Documentation](API_DOCUMENTATION.md)
- [Deployment Guide](DEPLOYMENT.md)
- [Quick Start (Vietnamese)](QUICK_START_VI.md)
