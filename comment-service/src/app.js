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
import { createUserLoader } from "./graphql/loaders/userLoader.js";

function buildContextFromHeaders(headers = {}) {
  const userId = headers["x-user-id"];
  const userEmail = headers["x-user-email"];

  return {
    user: userId
      ? {
          userId: parseInt(userId, 10),
          email: userEmail,
        }
      : null,
    loaders: {
      user: createUserLoader(),
    },
  };
}
import commentRoutes from "./routes/commentRoutes.js";
import { initEventListener } from "./services/eventListener.js";
import { initEventPublisher } from "./services/eventPublisher.js";
import { createRedisClient } from "./config/redis.js";
import { closePubSub } from "./config/pubsub.js";
import { authenToken } from './services/userService.js'
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
      const req = ctx.extra?.request;
      if (req?.headers?.["x-user-id"]) {
        return buildContextFromHeaders(req.headers);
      }

      const token = ctx.connectionParams?.accessToken;
      if (token) {
        try {
          const { user } = await authenToken(token);
          if (user?.userId) {
            return {
              user: {
                userId: parseInt(user.userId, 10),
                email: user.email,
              },
              loaders: {
                user: createUserLoader(),
              },
            };
          }
        } catch {
          console.log("Invalid token in GraphQL WS context");
        }
      }

      return { loaders: { user: createUserLoader() } };
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
        if (req.headers["x-user-id"]) {
          return buildContextFromHeaders(req.headers);
        }

        const token =
          req.cookies?.access_token ||
          (req.headers.authorization &&
            req.headers.authorization.split(" ")[1]);

        if (token) {
          try {
            const { user } = await authenToken(token);
            if (user?.userId) {
              return {
                user: {
                  userId: parseInt(user.userId, 10),
                  email: user.email,
                },
                loaders: {
                  user: createUserLoader(),
                },
              };
            }
          } catch {
            console.log("Invalid token in GraphQL context");
          }
        }

        return { loaders: { user: createUserLoader() } };
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

  const PORT = process.env.PORT;
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

