import "dotenv/config";
import express from "express";
import cors from "cors";
import { ApolloServer } from "@apollo/server";
import { expressMiddleware } from "@apollo/server/express4";
import bodyParser from "body-parser";
import typeDefs from "./graphql/schema.js";
import resolvers from "./graphql/resolvers.js";
import { createUserLoader } from "./graphql/loaders/userLoader.js";
import { createRedisClient } from "./config/redis.js";
import { getTrustedIdentity } from "./middleware/trustedIdentity.js";
import { initOutboxPublisher } from "./services/eventPublisher.js";
import { requireServiceAuth } from "./middleware/serviceAuth.js";
import prisma from "./lib/prisma.js";

function buildContext(req) {
  return {
    user: getTrustedIdentity(req.headers),
    loaders: {
      user: createUserLoader(),
    },
  };
}

const app = express();

// Initialize Redis for caching
createRedisClient();

// Middleware
app.use(
  cors({
    origin: process.env.CLIENT_URL,
    credentials: true,
  })
);
app.use(express.json());

// Apollo Server
const apolloServer = new ApolloServer({
  typeDefs,
  resolvers,
});

async function startServer() {
  await apolloServer.start();
  initOutboxPublisher();

  app.get("/internal/posts/:id", requireServiceAuth, async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isSafeInteger(id) || id <= 0) {
        return res.status(400).json({ success: false, message: "Invalid post id" });
      }
      const post = await prisma.post.findUnique({
        where: { id },
        select: { id: true, userId: true, isHidden: true },
      });
      if (!post || post.isHidden) {
        return res.status(404).json({ success: false, message: "Post not found" });
      }
      return res.json({ success: true, data: { id: post.id, userId: post.userId } });
    } catch (error) {
      return next(error);
    }
  });

  // Apollo v4 uses expressMiddleware instead of applyMiddleware
  app.use(
    "/graphql",
    bodyParser.json(),
    expressMiddleware(apolloServer, {
      context: async ({ req }) => buildContext(req),
    })
  );

  // Health check
  app.get("/health", (req, res) => {
    res.json({
      success: true,
      service: "post-service",
      timestamp: new Date().toISOString(),
    });
  });

  // Error handler
  app.use((err, req, res, next) => {
    console.error("Post service error:", err);
    res.status(err.status || 500).json({
      success: false,
      message: err.message || "Internal server error",
    });
  });

  const PORT = process.env.PORT;
  app.listen(PORT, () => {
    console.log(`📝 Post Service running on port ${PORT}`);
    console.log(
      `🔗 GraphQL endpoint: http://localhost:${PORT}${apolloServer.graphqlPath}`
    );
  });
}

startServer().catch((error) => {
  console.error("Failed to start Post Service:", error);
  process.exit(1);
});
