import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const connectionString = `${process.env.DATABASE_URL}`;

const adapter = new PrismaPg({ connectionString, connection_limit: 10, pool_timeout: 20 });
const prisma = new PrismaClient({ adapter });

export default prisma;
