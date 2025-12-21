import "dotenv/config";
import express from "express";
import cors from "cors";
import { createServer } from "http";
import { ApolloServer } from "@apollo/server";
import { expressMiddleware } from "@apollo/server/express4";
import { ApolloServerPluginDrainHttpServer } from "@apollo/server/plugin/drainHttpServer";
import { WebSocketServer } from "ws";
import { useServer } from "graphql-ws/lib/use/ws";
import { makeExecutableSchema } from "@graphql-tools/schema";
import bodyParser from "body-parser";
import typeDefs from "./graphql/schema.js";
import resolvers from "./graphql/resolvers.js";
import commentRoutes from "./routes/commentRoutes.js";
import { initEventListener } from "./services/eventListener.js";
import { initEventPublisher } from "./services/eventPublisher.js";
import { createRedisClient } from "./config/redis.js";
import { closePubSub } from "./config/pubsub.js";

const app = express();
const httpServer = createServer(app);

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

// Routes
app.use("/api/comments", commentRoutes);

// Create GraphQL schema
const schema = makeExecutableSchema({ typeDefs, resolvers });

// Create WebSocket server for subscriptions
const wsServer = new WebSocketServer({
  server: httpServer,
  path: "/graphql",
});

// Setup GraphQL WebSocket server with authentication
const serverCleanup = useServer(
  {
    schema,
    context: async (ctx) => {
      // Get user info from connection params (sent during connection)
      const userId = ctx.connectionParams?.["x-user-id"];
      const userEmail = ctx.connectionParams?.["x-user-email"];

      return {
        user: userId
          ? {
            userId: parseInt(userId),
            email: userEmail,
          }
          : null,
      };
    },
    onConnect: async (ctx) => {
      console.log("🔌 [WebSocket] Client connected");
    },
    onDisconnect: async (ctx) => {
      console.log("🔌 [WebSocket] Client disconnected");
    },
  },
  wsServer
);

// Apollo Server with subscription support
const apolloServer = new ApolloServer({
  schema,
  plugins: [
    // Proper shutdown for HTTP server
    ApolloServerPluginDrainHttpServer({ httpServer }),
    // Proper shutdown for WebSocket server
    {
      async serverWillStart() {
        return {
          async drainServer() {
            await serverCleanup.dispose();
          },
        };
      },
    },
  ],
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
      service: "comment-service",
      timestamp: new Date().toISOString(),
    });
  });

  // Error handler
  app.use((err, req, res, next) => {
    console.error("Comment service error:", err);
    res.status(err.status || 500).json({
      success: false,
      message: err.message || "Internal server error",
    });
  });

  const PORT = process.env.PORT || 3004;
  httpServer.listen(PORT, () => {
    // Initialize event systems
    initEventListener();
    initEventPublisher();
  });

  // Graceful shutdown
  const gracefulShutdown = async (signal) => {
    console.log(`\n${signal} received, closing server gracefully...`);

    try {
      // Close WebSocket connections
      await serverCleanup.dispose();
      console.log('✅ WebSocket connections closed');

      // Stop HTTP server
      httpServer.close(() => {
        console.log('✅ HTTP server closed');
      });

      // Close Redis PubSub connections
      await closePubSub();

      process.exit(0);
    } catch (error) {
      process.exit(1);
    }
  };

  // Handle shutdown signals
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
}

startServer().catch((error) => {
  process.exit(1);
});

