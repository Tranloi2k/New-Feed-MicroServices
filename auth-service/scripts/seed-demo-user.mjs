import "dotenv/config";
import bcrypt from "bcryptjs";
import prisma from "../src/lib/prisma.js";

const isEnabled =
  process.env.DEMO_LOGIN_ENABLED === "true" ||
  (process.env.DEMO_LOGIN_ENABLED !== "false" &&
    process.env.NODE_ENV !== "production");

if (!isEnabled) {
  console.log("Demo login seed skipped");
  await prisma.$disconnect();
  process.exit(0);
}

const email = process.env.DEMO_USER_EMAIL || "demo@newfeed.local";
const password = process.env.DEMO_USER_PASSWORD || "Demo123!";
const username = process.env.DEMO_USER_USERNAME || "demo";
const fullName = process.env.DEMO_USER_FULL_NAME || "Demo User";
const saltRounds = Number(process.env.BCRYPT_ROUNDS || 10);

try {
  const passwordHash = await bcrypt.hash(password, saltRounds);

  await prisma.user.upsert({
    where: { email },
    update: { passwordHash, fullName },
    create: { email, passwordHash, username, fullName },
  });

  console.log(`Demo login ready: ${email}`);
} finally {
  await prisma.$disconnect();
}
