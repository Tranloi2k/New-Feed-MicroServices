import "dotenv/config";
import prisma from "../src/lib/prisma.js";

const retentionDays = Number(process.env.REFRESH_TOKEN_RETENTION_DAYS || 30);
if (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 365) {
  throw new Error("REFRESH_TOKEN_RETENTION_DAYS must be an integer between 1 and 365");
}

const revokedBefore = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

try {
  const deleted = await prisma.refreshToken.deleteMany({
    where: {
      OR: [
        { expiresAt: { lt: new Date() } },
        { revokedAt: { lt: revokedBefore } },
      ],
    },
  });
  console.log(JSON.stringify({ event: "refresh_tokens_cleaned", deleted: deleted.count }));
} finally {
  await prisma.$disconnect();
}
