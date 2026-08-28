import "dotenv/config";
import prisma from "../src/lib/prisma.js";
import cacheService from "../src/services/cacheService.js";
import { closeRedisConnection } from "../src/config/redis.js";

const authorId = Number(process.env.DEMO_POST_AUTHOR_ID);

if (!Number.isSafeInteger(authorId) || authorId <= 0) {
  throw new Error("DEMO_POST_AUTHOR_ID must be a positive integer");
}

const demoPosts = [
  {
    userId: authorId,
    content:
      "Chào mừng bạn đến với NewFeed! Đây là bài viết đầu tiên của tài khoản demo.",
    postType: "text",
  },
  {
    userId: authorId,
    content:
      "Một ngày mới, một ý tưởng mới. Hôm nay bạn đang xây dựng điều gì thú vị?",
    postType: "text",
    location: "Đà Nẵng, Việt Nam",
  },
  {
    userId: authorId,
    content:
      "Microservices giúp từng phần của hệ thống phát triển độc lập, nhưng observability và data consistency luôn cần được thiết kế cẩn thận. #backend #microservices",
    postType: "text",
  },
  {
    userId: authorId,
    content:
      "NewFeed demo đã sẵn sàng. Hãy thử tạo bài viết, bình luận và theo dõi thông báo realtime nhé!",
    postType: "text",
  },
];

try {
  const [deleted, created] = await prisma.$transaction([
    prisma.post.deleteMany(),
    prisma.post.createMany({ data: demoPosts }),
  ]);

  await cacheService.invalidateAllPostData();
  console.log(
    `Demo posts ready: deleted ${deleted.count}, created ${created.count} for user ${authorId}`
  );
} finally {
  await Promise.allSettled([
    prisma.$disconnect(),
    closeRedisConnection(),
  ]);
}
