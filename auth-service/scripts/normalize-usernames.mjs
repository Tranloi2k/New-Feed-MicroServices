/**
 * One-off: fix legacy usernames (spaces, emails) → slug [a-z0-9_].
 * Run: node scripts/normalize-usernames.mjs
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const connectionString = process.env.DATABASE_URL;
const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

const USERNAME_RE = /^[a-zA-Z0-9_]{3,30}$/;

function toSlug(value) {
  return (
    value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/@.+$/, "")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 30) || "user"
  );
}

async function uniqueUsername(base, excludeId) {
  let candidate = base;
  let n = 1;
  while (true) {
    const existing = await prisma.user.findFirst({
      where: { username: candidate, NOT: { id: excludeId } },
    });
    if (!existing) return candidate;
    const suffix = String(n++);
    candidate = `${base.slice(0, Math.max(1, 30 - suffix.length))}${suffix}`;
  }
}

async function main() {
  const users = await prisma.user.findMany({
    select: { id: true, username: true, email: true },
  });

  for (const user of users) {
    if (USERNAME_RE.test(user.username)) continue;

    const base = toSlug(user.username || user.email || `user${user.id}`);
    const username = await uniqueUsername(base, user.id);

    await prisma.user.update({
      where: { id: user.id },
      data: { username },
    });

    console.log(`  user ${user.id}: "${user.username}" → "${username}"`);
  }

  console.log("Done.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
