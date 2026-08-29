import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL,
  connection_limit: 10,
  pool_timeout: 20,
});

const prisma = new PrismaClient({ adapter });
export default prisma;
