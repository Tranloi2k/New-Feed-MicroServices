## 📋 Improvement Checklist Plan (Code-Level Only)

> **Scope:** Chỉ tập trung vào tối ưu **code** và kiến trúc ứng dụng. Không bao gồm nâng cấp hạ tầng (CPU/RAM, Kubernetes, autoscaling...).

---

## ✅ Global & Architecture

- [ ] **Chuẩn hóa môi trường**: Đảm bảo tất cả service dùng chung convention về `LOGGER`, `ENV`, error shape.
- [ ] **Service-to-service auth**: Rà soát và thống nhất cách dùng `X-Service-Token` giữa các service (nơi nào đang bỏ trống thì bổ sung).
- [ ] **DTO / schema validation**: Dùng thư viện (ví dụ `zod` / `yup` / `joi`) để validate toàn bộ input quan trọng (auth, post, comment, upload).
- [ ] **Giới hạn kích thước request**: Thêm `limit` hợp lý cho JSON body, file upload, v.v. để tránh abuse.

---

## 🧩 API Gateway

- [ ] **JWT handling tại Gateway**  
  - [ ] Decode & verify JWT trực tiếp ở Gateway (dùng `JWT_SECRET`), chỉ gọi Auth Service khi cần thêm thông tin user.  
  - [ ] Chuẩn hóa header `X-User-Id`, `X-User-Email` gửi xuống services.
- [ ] **Rate limiting với Redis**  
  - [ ] Kiểm tra lại key pattern (kết hợp IP + userId nếu có) để tránh under/over-throttle.  
  - [ ] Log số lần hit rate limit để theo dõi.
- [ ] **Proxy tối ưu**  
  - [ ] Hạn chế parse JSON nhiều lần trước khi proxy (`bodyParser` vs `restreamBody`).  
  - [ ] Thêm timeout, retry policy hợp lý cho từng service (Auth/Post/Comment/Media).
- [ ] **Error handling thống nhất**  
  - [ ] Chuẩn hóa lỗi proxy (502, message, error code) trả về client.  
  - [ ] Ghi log có cấu trúc kèm `requestId`, `userId`.

---

## 🔐 Auth Service

- [ ] **DB & Prisma**  
  - [ ] Đảm bảo index trên `email`, `username`.  
  - [ ] Giới hạn các query trả về danh sách user (nếu có) với `take`/`skip`.  
  - [ ] Thêm connection pooling cấu hình qua `DATABASE_URL` (Prisma).
- [ ] **Caching với Redis (DB3)**  
  - [ ] Cache user profile cơ bản (`id`, `username`, `avatarUrl`) theo `userId`.  
  - [ ] Thêm TTL hợp lý (5–30 phút) và invalidation khi user cập nhật profile.  
  - [ ] Cache `user_exists` check cho signup/login để giảm tải DB.
- [ ] **Security**  
  - [ ] Kiểm tra lại strength của password hashing (`bcrypt` rounds).  
  - [ ] Bảo vệ endpoint auth khỏi brute-force (rate limit riêng cho `/login` / `/signup`).

---

## 📝 Post Service (GraphQL)

- [ ] **Tối ưu Prisma query**  
  - [ ] Dùng `select`/`include` tối ưu, tránh lấy field thừa.  
  - [ ] Tránh N+1 query khi fetch author thông qua DataLoader hoặc join phù hợp.  
  - [ ] Index cho các cột `authorId`, `createdAt`.
- [ ] **Pagination & giới hạn**  
  - [ ] Giới hạn `limit` tối đa trong input (ví dụ `max 50`).  
  - [ ] Đảm bảo cursor-based pagination được dùng ở mọi query list (feed).
- [ ] **Redis cache (DB1)**  
  - [ ] Cache newsfeed theo người dùng (key dạng `post:newsfeed:{userId}:{cursor}`).  
  - [ ] Cache chi tiết post (`post:single:{postId}`).  
  - [ ] Triển khai invalidation khi tạo/xóa/sửa post (xóa key/pattern tương ứng).  
  - [ ] Đo lường tỉ lệ cache hit/miss (log/metrics).
- [ ] **RabbitMQ publisher**  
  - [ ] Đảm bảo publish event `post.created` / `post.deleted` / `post.liked` chuẩn schema.  
  - [ ] Thêm retry nhẹ khi publish thất bại (hoặc log chi tiết + alert).

---

## 💬 Comment Service (GraphQL + Subscriptions)

- [ ] **Query & data model**  
  - [ ] Index cho `postId`, `userId`, `createdAt`, `parentCommentId`.  
  - [ ] Review các resolver để tránh N+1 khi load author/post.
- [ ] **Redis cache (DB2)**  
  - [ ] Cache danh sách comment theo `postId` (`comment:post:{postId}:*`).  
  - [ ] Cache chi tiết comment (`comment:single:{commentId}`).  
  - [ ] Rà soát invalidation khi tạo/sửa/xóa comment (bao gồm reply).  
- [ ] **GraphQL Subscriptions (WebSocket)**  
  - [ ] Đảm bảo `useServer` cleanup đúng khi client disconnect (không leak).  
  - [ ] Chuẩn hóa context (user từ header/connectionParams).  
  - [ ] Thêm auth check cho subscription (chỉ subscribe post mà user được phép xem).
- [ ] **RabbitMQ integration**  
  - [ ] Bảo đảm event `comment.created` gửi đủ thông tin cho Notification Service (postId, postAuthorId, commentAuthorId...).  
  - [ ] Log rõ ràng khi publish / consume thất bại.

---

## 🖼️ Media Service

- [ ] **Validation & security**  
  - [ ] Kiểm tra MIME type vs extension, chặn file nguy hiểm.  
  - [ ] Giới hạn kích thước file trên route (app-level).  
  - [ ] Thêm scan cơ bản (nếu có thể) hoặc validate strict whitelist định dạng.
- [ ] **Cloudinary integration**  
  - [ ] Chuẩn hóa folder/path lưu trữ theo userId/postId.  
  - [ ] Thêm transformation presets (resize, quality) để giảm băng thông.  
  - [ ] Xử lý retry nhẹ khi upload fail tạm thời.

---

## 🔔 Notification Service (Socket.IO)

- [ ] **Authentication cho Socket.IO**  
  - [ ] Bắt buộc client gửi JWT (qua query/header) khi connect.  
  - [ ] Validate JWT trong middleware Socket.IO, map ra `userId` và chỉ dùng `userId` này cho subscribe.  
  - [ ] Không tin tưởng `userId` do client gửi trực tiếp trong sự kiện.
- [ ] **Room & subscription**  
  - [ ] Chuẩn hóa room: `user:{userId}`, `post:{postId}`.  
  - [ ] Thêm cơ chế unsubscribe rõ ràng khi user logout/disconnect.  
  - [ ] Hạn chế số lượng room mà 1 socket có thể join.
- [ ] **Redis adapter (chuẩn bị scale)**  
  - [ ] Cài adapter Redis (`@socket.io/redis-adapter`, `redis` client).  
  - [ ] Cấu hình để có thể chạy nhiều instance notification-service (dù hiện tại chỉ 1 instance).  
- [ ] **Payload & tần suất**  
  - [ ] Thiết kế schema notification gọn (id, type, refId), client tự fetch thêm khi cần.  
  - [ ] Nếu có nhiều event dồn dập, xem xét debounce/batch một số loại notification.

---

## 🐰 RabbitMQ (Event Bus)

- [ ] **Channel & prefetch**  
  - [ ] Thiết lập `channel.prefetch(N)` cho consumer (Notification, Comment nếu có).  
  - [ ] Đảm bảo `ack/nack` được dùng đúng cách để tránh mất message.
- [ ] **DLQ & TTL (ở mức code + config)**  
  - [ ] Thêm queue DLQ (`events.dlq`) và exchange `dlx` cho message lỗi nhiều lần.  
  - [ ] Đặt TTL hợp lý cho message (ví dụ 24h) trong producer.  
- [ ] **Schema & versioning**  
  - [ ] Định nghĩa rõ event type (`post.created`, `comment.created`, `like.created`...) cùng payload chuẩn.  
  - [ ] Thêm `version` vào payload để cho phép nâng cấp không phá vỡ backward compatibility.

---

## ⚡ Redis & Caching Strategy

- [ ] **Key design**  
  - [ ] Chuẩn hóa prefix theo service: `auth:*`, `post:*`, `comment:*`, `gateway:*`.  
  - [ ] Tài liệu hóa các key pattern chính trong một file docs riêng.
- [ ] **TTL & invalidation**  
  - [ ] Đảm bảo **mọi cache write** đều có TTL hợp lý.  
  - [ ] Viết helper chung cho cache invalidation (xử lý pattern bằng `SCAN` thay vì `KEYS`).
- [ ] **Metrics cache**  
  - [ ] Log tỉ lệ cache hit/miss cho các endpoint quan trọng (feed, comments).  
  - [ ] Dùng metrics (Prometheus) nếu có để biết cache có thực sự hiệu quả.

---

## 🔍 Observability & Quality

- [ ] **Logging chuẩn**  
  - [ ] Dùng `logger` chung (trong `shared`) cho tất cả service.  
  - [ ] Thêm `requestId` (và `userId` nếu có) vào log theo chuỗi call (Gateway → Service).  
  - [ ] Log ở các mức `info`, `warn`, `error` nhất quán.
- [ ] **Metrics (nếu triển khai Prometheus)**  
  - [ ] Thêm middleware đo `latency`, `status_code`, `throughput` cho mỗi service.  
  - [ ] Đánh dấu các endpoint nặng (feed, comments list) để theo dõi riêng.
- [ ] **Error handling**  
  - [ ] Đảm bảo tất cả route/resolver async có `try/catch` hoặc middleware error handler bao trùm.  
  - [ ] Chuẩn hóa cấu trúc error trả về client (code, message, details optional).

---

## 🚀 Lộ trình gợi ý

1. **Bước 1:** Tập trung vào **DB + Prisma + Redis cache** cho Post và Comment (tác động lớn nhất tới hiệu năng).  
2. **Bước 2:** Siết lại **Auth + API Gateway** (JWT, rate limit, service-to-service auth).  
3. **Bước 3:** Cứng hóa **RabbitMQ + Notification Service (Socket.IO)** cho real-time ổn định.  
4. **Bước 4:** Thêm **logging/metrics** để đo lường, rồi tối ưu tiếp dựa trên số liệu thực tế.


