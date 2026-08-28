import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

// Startup validation rejects a missing URL. The non-routable fallback keeps
// dependency-injected unit tests from opening a real database connection.
const connectionString =
    process.env.DATABASE_URL || "postgresql://invalid:invalid@127.0.0.1:1/invalid";

const adapter = new PrismaPg({ connectionString, connection_limit: 10, pool_timeout: 20 });
const prisma = new PrismaClient({
    adapter,
    log: ['warn', 'error'],
});
export default prisma;
