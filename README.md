# NewFeed Microservices

Social media backend, 6 Node.js services running on a single K3s node. Deployed with ArgoCD.

K8s manifests are in a separate repo: [New-Feed-MicroServices-config](https://github.com/Tranloi2k/New-Feed-MicroServices-config).

## Services

| Service | Port | What it does |
|---|---|---|
| api-gateway | 8080 | Entry point. JWT check, rate limit, proxy |
| auth-service | 3001 | Signup, login, JWT in httpOnly cookie |
| post-service | 3002 | Posts and feed, GraphQL, cursor pagination |
| comment-service | 3004 | Comments, GraphQL Subscriptions |
| media-service | 3003 | Upload to Cloudinary |
| notification-service | 3005 | Socket.IO, consumes RabbitMQ events |

Each service has its own Postgres database. Redis for cache and Pub/Sub. RabbitMQ for events between services.

## Architecture

```
                          ┌─────────────┐
                          │   Client    │ (Web / Mobile)
                          └──────┬──────┘
                                 │  HTTP / GraphQL / WebSocket
                                 ▼
                 ┌───────────────────────────────────┐
                 │      Traefik Ingress :80/:443     │  (bundled with K3s)
                 │  Host-based routing:              │
                 │    api.<ip>.nip.io      → Gateway │
                 │    argocd.<ip>.nip.io   → ArgoCD  │
                 │    grafana.<ip>.nip.io  → Grafana │
                 └───────────────┬───────────────────┘
                                 │
┌────────────────────────────────▼─────────────────────────────────┐
│                       API Gateway :8080                          │
│  - JWT auth via httpOnly cookie (calls Auth Service)             │
│  - Redis rate limiting (100 req / 15 min per IP)                 │
│  - Compression & circuit breaker                                 │
│  - Service-to-service auth via X-Service-Token                   │
│  - Proxy:                                                        │
│      /api/auth                → Auth Service                     │
│      /graphql/post            → Post Service                     │
│      /graphql/comment         → Comment Service                  │
│      /api/media               → Media Service                    │
│      /notifications/socket.io → Notification Service             │
└──────┬──────────────┬──────────────┬──────────────┬──────────────┘
       │              │              │              │
       ▼              ▼              ▼              ▼
  ┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐
  │  Auth   │    │  Post   │    │ Comment │    │  Media  │
  │ Service │    │ Service │    │ Service │    │ Service │
  │  :3001  │    │  :3002  │    │  :3004  │    │  :3003  │
  │─────────│    │─────────│    │─────────│    │─────────│
  │ REST    │    │ GraphQL │    │ GraphQL │    │ REST    │
  │ bcrypt  │    │ cursor  │    │ + Subs  │    │ multer  │
  │ JWT     │    │ paging  │    │  (WS)   │    │         │
  └────┬────┘    └────┬────┘    └────┬────┘    └────┬────┘
       │              │              │              │
       ▼              ▼              ▼              ▼
 [PostgreSQL]   [PostgreSQL]   [PostgreSQL]   [Cloudinary]
   auth_db        post_db       comment_db      media_cdn
  StatefulSet    StatefulSet    StatefulSet      external

              ┌────────────────────────────────────────────┐
              │            Notification Service            │
              │              :3005 (Socket.IO)             │
              │────────────────────────────────────────────│
              │  RabbitMQ consumer → push to connected     │
              │  clients by userId subscription            │
              └──────┬──────────────────────┬──────────────┘
                     │                      ▼
                     │               [PostgreSQL]
                     │              notification_db
                     ▼
        ┌─────────────────────────────────────────────────┐
        │                RabbitMQ :5672                   │
        │  Topic exchange, event-driven communication     │
        │─────────────────────────────────────────────────│
        │  Published by Post Service:                     │
        │    post.created, post.deleted, post.liked       │
        │  Published by Comment Service:                  │
        │    comment.created, comment.deleted             │
        │  Also: like.created                             │
        │─────────────────────────────────────────────────│
        │  Consumers:                                     │
        │    Comment Service  → cascade delete comments   │
        │                       when post.deleted         │
        │    Notification Svc → fan-out to Socket.IO      │
        └─────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────┐
│                        Redis :6379                         │
│  - DB 0: API Gateway rate limiting                         │
│  - DB 1: Post cache (feeds, single posts)                  │
│  - DB 2: Comment cache & GraphQL subscriptions (Pub/Sub)   │
│  - DB 3: Auth cache (user data)                            │
│                                                            │
│  Pub/Sub keeps WebSocket state consistent when a service   │
│  runs more than one replica: a client on pod A still gets  │
│  events produced on pod B.                                 │
└────────────────────────────────────────────────────────────┘
```

### Request paths

**Synchronous.** Client hits the gateway, gateway validates the JWT cookie and proxies to the service. Services also call each other directly for lookups (post-service asks auth-service for author details), authenticated with a shared `X-Service-Token` header rather than a user JWT.

**Asynchronous.** Post and comment services publish to RabbitMQ and return immediately. Two consumers listen: comment-service cascades deletes when a post disappears, notification-service turns events into pushes. A slow or dead notification service does not block a user from posting.

**Real-time.** Two separate channels, for historical reasons more than good ones. Comments use GraphQL Subscriptions over WebSocket directly against comment-service. Notifications use Socket.IO against notification-service. Both are backed by Redis Pub/Sub so a client connected to replica A still sees events produced on replica B.

### Why the boundaries are where they are

Comments and notifications hold WebSocket connections open, so they scale on concurrent connections. Post and auth scale on request rate. Media is mostly waiting on Cloudinary. Different scaling axes, so they get to scale independently.

Databases are split per service on purpose. It means no cross-service joins, which would quietly become a contract nobody can change. The cost is that consistency between services is eventual, and that is what RabbitMQ is for.

Honest caveat: at the traffic this actually serves, a single Express app with one Postgres would do the same job with a tenth of the moving parts. The split is here because the failure modes and the scaling story are what I wanted to build and understand, not because the load demands it.

## Stack

Node.js 18, Express, Apollo Server, Prisma, Socket.IO, PostgreSQL 14, Redis 7, RabbitMQ 3.

Docker, K3s, Traefik, ArgoCD, Prometheus, Grafana. CI on GitHub Actions, images on GHCR.

## Running locally

```bash
cp .env.example .env
# fill in JWT_SECRET, SERVICE_SECRET, POSTGRES_*, RABBITMQ_*, CLOUDINARY_*

export IMAGE_TAG=$(git rev-parse HEAD)
docker compose up -d

curl http://localhost:8080/api/auth/health
```

Without Docker:

```bash
./install-all.sh
./migrate-all.sh
cd auth-service && npm run dev   # repeat per service
```

## Deployment

Runs on one Contabo VPS, 4 vCPU and 8 GB RAM, K3s single node.

Push to `main`, then:

1. Actions builds 6 images in parallel, tags each with the commit SHA, pushes to GHCR
2. A second job clones the config repo, updates the image tags, commits
3. ArgoCD sees the new commit and syncs

CI has no cluster access. It only writes to the config repo. That was the point of splitting the repos: before this, every build pushed a commit onto the branch I was working on, and I had to pull before touching anything.

Tags are always the commit SHA. `latest` does not work with ArgoCD because the manifest never changes, so there is nothing to sync.

Migrations run in an initContainer with `prisma migrate deploy`. During a rolling update the old pod is still serving traffic, so migrations have to be backward compatible. Adding a column is fine, renaming one is not.

## Monitoring

kube-prometheus-stack via Helm. Prometheus keeps 7 days, Grafana on top. Alertmanager is off.

The VPS has no swap, so a pod that goes over its limit gets OOM killed instead of slowing down. Every workload has requests and limits set, and they are set tight on purpose. Grafana was the one that surprised me, its dashboard sidecar container needed its own limit.

Right now the dashboards only show cluster and node metrics. App level metrics (request rate, latency, error rate) still need `prom-client` in each service plus a ServiceMonitor. Not done yet.

## Layout

```
api-gateway/
auth-service/
post-service/
comment-service/
media-service/
notification-service/
shared/                 # service auth middleware, winston logger
infra/                  # applied by hand, not managed by ArgoCD
docker-compose.yml
.github/workflows/
```

`infra/` has the things that bootstrap the cluster: the ArgoCD Application itself, ingress for ArgoCD and Grafana, Helm values for monitoring. Chicken and egg problem, ArgoCD cannot manage its own installation.

## Notes

Secrets live in a Kubernetes Secret created from an env file on the host. Not in git. Changing one means recreating the secret and restarting the deployments, which is the one manual step left in the pipeline. Sealed Secrets would fix this.

Service to service calls carry a shared secret header, so hitting a service directly does not bypass the gateway.

Only Traefik listens on 80 and 443. Internal service ports are not published.

## TODO

- App level metrics with prom-client
- Real domain and HTTPS (currently on nip.io)
- Sealed Secrets so the secret is in git
- Chat service, see CHAT_SYSTEM_DESIGN.md