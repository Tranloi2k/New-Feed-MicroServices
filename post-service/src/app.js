import "dotenv/config";
import express from "express";
import cors from "cors";
import { ApolloServer } from "@apollo/server";
import { expressMiddleware } from "@apollo/server/express4";
import bodyParser from "body-parser";
import typeDefs from "./graphql/schema.js";
import resolvers from "./graphql/resolvers.js";
import { createRedisClient } from "./config/redis.js";

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

  // Apollo v4 uses expressMiddleware instead of applyMiddleware
  app.use(
    "/graphql",
    bodyParser.json(),
    expressMiddleware(apolloServer, {
      context: async ({ req }) => {
        // User info from API Gateway headers
        const userId = req.headers["x-user-id"];
        const userEmail = req.headers["x-user-email"];

        return {
          user: userId
            ? {
              userId: parseInt(userId),
              email: userEmail,
            }
            : null,
        };
      },
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
