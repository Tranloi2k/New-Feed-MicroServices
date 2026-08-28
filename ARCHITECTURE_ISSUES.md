# New Feed Microservices — Architecture Review

Ngày review: 2026-08-28  
Phạm vi: `New-Feed-MicroServices`  
Trạng thái: Các vấn đề đã được xác minh từ code và cấu hình hiện tại; chưa bao gồm kiểm thử tải hoặc kiểm thử end-to-end.

## Tóm tắt

Hệ thống đã phân tách tương đối rõ theo service và database, nhưng chưa an toàn để triển khai production. Ba nhóm rủi ro lớn nhất là:

1. Trust boundary giữa client, API Gateway và internal service chưa được bảo vệ.
2. Event-driven flow không đảm bảo delivery, idempotency và consistency.
3. Database schema và deployment chưa có quy trình migration an toàn, tái lập được.

## Danh sách ưu tiên

| ID | Mức độ | Vấn đề | Tác động chính |
| --- | --- | --- | --- |
| ARCH-01 | P0 | Có thể giả mạo identity qua `X-User-Id` | Tạo/xóa dữ liệu dưới danh nghĩa user khác |
| ARCH-02 | P0 | Internal Auth API bị expose qua gateway | Rò rỉ thông tin user và phá vỡ service boundary |
| ARCH-03 | P1 | Event có thể mất hoặc được xử lý trùng | Mất notification, orphan data, duplicate notification |
| ARCH-04 | P1 | Event contract không khớp producer–consumer | Notification bài viết/comment hiện không hoạt động đúng |
| ARCH-05 | P1 | Không đảm bảo invariant Post–Comment | Orphan comment và reply gắn chéo post |
| ARCH-06 | P1 | Schema database được push khi container startup | Có nguy cơ mất dữ liệu và race khi deploy |
| ARCH-07 | P1 | Circuit breaker không bao quanh request thật | Không ngăn được cascading failure như thiết kế |
| ARCH-08 | P2 | Cấu hình và vận hành chưa tái lập được | Quick start lỗi, health check sai lệch, build không deterministic |

## Chi tiết vấn đề

### ARCH-01 — Có thể giả mạo identity qua `X-User-Id`

**Mức độ:** P0

**Trạng thái:** Đã xử lý ngày 2026-08-28. Gateway hiện loại bỏ internal identity header từ client, downstream chỉ tin identity kèm `X-Service-Token`, và Notification Service chỉ bind port host vào loopback. Regression test nằm tại `tests/identity-boundary.test.mjs`.

API Gateway cho phép Post GraphQL dùng authentication tùy chọn:

- `api-gateway/src/app.js:144-149`

Gateway chỉ ghi đè `X-User-Id` khi đã xác thực được JWT, nhưng không xóa identity header do client tự gửi:

- `api-gateway/src/utils/proxyHelpers.js:13-17`

Post Service tin trực tiếp header này để dựng user context:

- `post-service/src/app.js:12-26`

Vì proxy mặc định giữ header đầu vào, request không có JWT vẫn có thể tự đặt `X-User-Id` rồi gọi `createPost` hoặc `deletePost` dưới danh nghĩa user khác.

Notification Service cũng ưu tiên tin `X-User-Id` trước khi kiểm JWT:

- `notification-service/src/middleware/httpAuth.js:3-13`

Trong Docker Compose, Notification Service đang expose port `3005` ra mọi interface:

- `docker-compose.yml:109-125`

**Khuyến nghị:**

- Luôn xóa `X-User-Id`, `X-User-Email` và các internal header do client gửi trước authentication.
- Gateway chỉ thêm identity header sau khi JWT được xác minh.
- Internal service phải xác minh nguồn identity bằng signed internal JWT, mTLS hoặc service credential riêng.
- Không publish trực tiếp port của internal service ra host/public network.

### ARCH-02 — Internal Auth API bị expose qua gateway

**Mức độ:** P0

**Trạng thái:** Đã xử lý ngày 2026-08-28. Gateway chỉ proxy allowlist các auth action public và `/me`; mọi `/api/auth/internal/*` trả `404`. Các internal route của Auth Service đồng thời bắt buộc `X-Service-Token` qua middleware dùng so sánh constant-time, và payload lookup nội bộ chỉ còn các trường identity/profile cần cho consumer. Regression tests nằm tại `api-gateway/test/appComposition.test.js` và `tests/identity-boundary.test.mjs`.

**Nguyên nhân ban đầu (đã loại bỏ):** Gateway từng proxy toàn bộ prefix `/api/auth`:

- `api-gateway/src/app.js:230-238`

Do đó client từng có thể gọi `/api/auth/internal/users/:id`, được rewrite thành internal endpoint của Auth Service. Route này khi đó chưa có service-auth middleware:

- `auth-service/src/routes/authRoutes.js:22-23`

Response trước đây chứa cả các trường không cần thiết như trạng thái private:

- `auth-service/src/controllers/authController.js:303-345`

**Biện pháp đã áp dụng:**

- Gateway từ chối mọi path `/internal/*` từ public ingress.
- Tách public router và internal router.
- Bắt buộc service authentication ngay tại Auth Service, không chỉ dựa vào network topology.
- Hạn chế payload internal theo nguyên tắc least privilege.

### ARCH-03 — Event có thể mất hoặc được xử lý trùng

**Mức độ:** P1

**Trạng thái:** Đã xử lý. Producer dùng transactional outbox và publisher confirm; consumer dùng durable queue, retry/DLQ và inbox idempotency theo `eventId`. Delivery là at-least-once, side effect trong database được khử trùng.

Post và Comment ghi database trước rồi mới publish event, không có transactional outbox. Publisher bỏ qua hoặc nuốt lỗi khi RabbitMQ không hoạt động:

- `post-service/src/graphql/resolvers.js:179-195`
- `post-service/src/services/eventPublisher.js:22-40`
- `comment-service/src/graphql/resolvers.js:100-130`
- `comment-service/src/services/eventPublisher.js:22-45`

Notification và Comment consumer dùng anonymous exclusive queue:

- `notification-service/src/services/eventListener.js:20-49`
- `comment-service/src/services/eventListener.js:6-35`

Hệ quả:

- Queue biến mất khi consumer disconnect, nên event trong downtime bị mất.
- Mỗi Notification replica tạo queue riêng và đều nhận event, dễ tạo notification trùng.
- Consumer persist trước `ack`; nếu crash giữa hai bước, RabbitMQ redelivery có thể tạo bản ghi trùng.
- Notification schema không có `eventId` unique để xử lý idempotent.

**Khuyến nghị:**

- Dùng transactional outbox trong database của producer.
- Dùng publisher confirms và kiểm tra kết quả `channel.publish`.
- Dùng durable named queue cho từng consumer group.
- Thêm retry policy, dead-letter exchange/queue và monitoring.
- Chuẩn hóa event envelope có `eventId`, `eventType`, `version`, `occurredAt`, `correlationId`.
- Thêm inbox/idempotency table với unique constraint trên `eventId`.

### ARCH-04 — Event contract không khớp producer–consumer

**Mức độ:** P1

**Trạng thái:** Đã xử lý cho notification bài viết mới và comment mới.

Post Service phát `post.created` chỉ gồm `postId`, `userId`:

- `post-service/src/graphql/resolvers.js:189-193`

Notification Service lại cần `followers` và mặc định dùng mảng rỗng:

- `notification-service/src/services/eventListener.js:109-119`

Do đó notification bài viết mới không được tạo.

Comment Service luôn phát `postAuthorId: null`:

- `comment-service/src/graphql/resolvers.js:120-130`

Notification Service chỉ tạo notification comment khi `postAuthorId` có giá trị:

- `notification-service/src/services/eventListener.js:85-97`

Ngoài ra `Post.commentCount`, `likeCount` và `shareCount` là dữ liệu denormalized nhưng hiện không có flow đáng tin cậy để cập nhật.

**Khuyến nghị:**

- Định nghĩa và version hóa event schema dùng chung.
- Viết consumer-driven contract tests.
- Để Notification Service resolve recipient từ local projection hoặc service chuyên trách; tránh nhét danh sách follower lớn vào event.
- Xác định rõ service sở hữu các counter và cơ chế cập nhật/rebuild chúng.

**Biện pháp đã áp dụng:**

- Chuẩn hóa envelope version 1 và validate các field bắt buộc trước khi consumer xử lý.
- `post.created` giữ payload nhỏ `{ postId, userId }`; Notification Service resolve follower qua internal Auth API được bảo vệ bằng service token.
- Comment Service tra cứu Post Service qua internal API trước khi ghi comment, rồi phát `comment.created` với `postAuthorId` thực.
- Event không đúng contract được retry có giới hạn rồi chuyển sang DLQ thay vì bị xử lý âm thầm.
- Thêm contract test cho `post.created`, `comment.created` và kiểm tra idempotency khi redelivery.

Phần counter denormalized (`commentCount`, `likeCount`, `shareCount`) vẫn cần một thiết kế ownership/rebuild riêng; không thuộc phạm vi notification contract của bản sửa này.

### ARCH-05 — Không đảm bảo invariant giữa Post và Comment

**Mức độ:** P1

`createComment` ghi trực tiếp `postId` và `parentCommentId` từ input mà không kiểm tra:

- Post có tồn tại hay không.
- Parent comment có tồn tại hay không.
- Parent comment có thuộc cùng post hay không.

Vị trí:

- `comment-service/src/graphql/resolvers.js:84-107`

Xóa comment khi post bị xóa lại phụ thuộc vào event và exclusive queue không bền vững:

- `comment-service/src/services/eventListener.js:14-50`

**Khuyến nghị:**

- Validate post qua Post Service hoặc một local projection trước khi tạo comment.
- Validate parent comment thuộc cùng `postId` trong transaction của Comment Service.
- Dùng durable event handling cho cascade cleanup.
- Có reconciliation job để phát hiện và xử lý orphan data.

### ARCH-06 — Database schema được thay đổi khi container startup

**Mức độ:** P1

Auth, Post, Comment và Notification chạy lệnh sau khi container khởi động:

```sh
prisma db push --accept-data-loss
```

Ví dụ:

- `auth-service/Dockerfile:15-17`
- `post-service/Dockerfile:15-17`
- `comment-service/Dockerfile:15-17`
- `notification-service/Dockerfile:15`

Chỉ Notification Service có migration được commit. Auth, Post và Comment không có migration history.

Hệ quả:

- Có thể mất dữ liệu khi schema thay đổi.
- Nhiều replica có thể đồng thời thay đổi schema.
- Không kiểm soát được rollout/rollback.
- Schema thực tế giữa các môi trường có thể khác nhau.

**Khuyến nghị:**

- Commit migration cho từng service.
- Chạy `prisma migrate deploy` bằng migration job riêng trước application rollout.
- Application container không tự thay đổi schema.
- Thêm backup và rollback procedure cho migration có rủi ro.

### ARCH-07 — Circuit breaker không bao quanh request thật

**Mức độ:** P1

**Trạng thái:** Đã xử lý ngày 2026-08-28 trong đợt refactor API Gateway. Circuit breaker hiện ghi nhận trực tiếp downstream response `5xx`, proxy error và timeout; có rolling window, fast-fail và một probe khi half-open. Regression tests nằm trong `api-gateway/test/circuitBreaker.test.js`.

Proxy request thật vẫn được gọi trực tiếp:

- `api-gateway/src/middleware/circuitBreakerProxy.js:187-189`

Breaker chỉ được `fire` bằng các request tổng hợp `HEAD /health` sau proxy error hoặc theo sampling:

- `api-gateway/src/middleware/circuitBreakerProxy.js:55-75`
- `api-gateway/src/middleware/circuitBreakerProxy.js:97-117`
- `api-gateway/src/middleware/circuitBreakerProxy.js:168-181`

Hệ quả:

- Business response 5xx không được tính chính xác.
- Breaker timeout không giới hạn request proxy thật.
- Circuit status có thể không phản ánh traffic thực tế.
- Không bảo vệ hiệu quả trước downstream latency hoặc cascading failure.

**Khuyến nghị:**

- Thực thi downstream request thật bên trong circuit breaker.
- Đặt connect, response và total timeout rõ ràng.
- Phân loại lỗi nào được tính vào breaker, ví dụ timeout/5xx thay vì 4xx.
- Tách readiness probe khỏi circuit statistics.

### ARCH-08 — Deployment và vận hành chưa tái lập được

**Mức độ:** P2

`.env.example` khai báo `AUTH_DB_URL`, `POST_DB_URL`, `COMMENT_DB_URL`, `RABBITMQ_URL`, trong khi Compose thực sự cần:

- `POSTGRES_USER`
- `POSTGRES_PASSWORD`
- `RABBITMQ_USER`
- `RABBITMQ_PASSWORD`

Vị trí:

- `.env.example:7-17`
- `docker-compose.yml:28-199`

`docker compose --env-file .env.example config` xác nhận các biến trên bị thay bằng chuỗi rỗng.

Các vấn đề vận hành liên quan:

- Health endpoint chỉ trả `200`, không kiểm tra DB, Redis hoặc RabbitMQ.
- Compose không có healthcheck/readiness và `depends_on` chỉ đảm bảo thứ tự start cơ bản.
- Các service không có test suite.
- Không có `package-lock.json` trong từng service; Docker dùng `npm install`, nên build không deterministic.
- Rate-limit dành cho thao tác tạo post không áp dụng được cho `/graphql/post`, vì gateway không phân tích GraphQL operation.
- Tài liệu port và Redis database allocation không hoàn toàn khớp code/Compose.

**Khuyến nghị:**

- Đồng bộ `.env.example` với các biến Compose thực sự sử dụng.
- Thêm startup, liveness và readiness probe riêng.
- Commit lockfile và dùng `npm ci` trong Docker build.
- Thêm unit, integration, contract và smoke test.
- Rate-limit GraphQL theo authenticated principal, operation name và cost/depth.
- Đồng bộ tài liệu kiến trúc từ một nguồn cấu hình chuẩn.

## Lộ trình xử lý đề xuất

### Giai đoạn 1 — Security hotfix

- [x] Strip toàn bộ client-supplied internal identity headers tại gateway.
- [x] Bắt buộc trusted identity cho Post mutations.
- [ ] Chặn public access tới `/internal/*`.
- [ ] Thêm service authentication tại các internal endpoint ngoài identity propagation.
- [x] Không expose Notification Service trực tiếp ra public host network.

### Giai đoạn 2 — Khôi phục tính đúng của chức năng

- [ ] Sửa contract `post.created` và `comment.created`.
- [ ] Bổ sung contract tests cho Post/Comment → Notification.
- [ ] Validate Post–Comment invariants.
- [ ] Xác định ownership và cập nhật đúng các denormalized counter.

### Giai đoạn 3 — Event reliability

- [ ] Transactional outbox cho Post và Comment Service.
- [ ] Durable queue, publisher confirms, DLQ và retry policy.
- [ ] Idempotent consumer/inbox với unique `eventId`.
- [ ] Reconciliation jobs cho comment và notification.

### Giai đoạn 4 — Deployment và operability

- [ ] Tạo migration history cho mọi database service.
- [ ] Loại bỏ `db push --accept-data-loss` khỏi application startup.
- [ ] Sửa `.env.example`, thêm healthcheck/readiness.
- [ ] Commit package lock và chuyển Docker build sang `npm ci`.
- [x] Sửa circuit breaker để theo dõi request thật.
- [ ] Thêm tracing, metrics và structured logging xuyên service.

## Kiểm chứng đã thực hiện

- `node --check` trên toàn bộ JavaScript service: đạt.
- `docker compose --env-file .env.example config --quiet`: cấu hình parse được nhưng cảnh báo thiếu các biến PostgreSQL và RabbitMQ cần thiết.
- Không chạy integration test vì repository hiện không có test suite và cấu hình mẫu chưa cung cấp đủ credentials để dựng môi trường hoàn chỉnh.
