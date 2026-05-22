import "dotenv/config";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { createServer } from "http";
import { Server } from "socket.io";
import notificationRoutes from "./routes/notificationRoutes.js";
import { initEventListener } from "./services/eventListener.js";
import { socketAuthMiddleware } from "./middleware/socketAuth.js";

const app = express();
const httpServer = createServer(app);

app.use(
  cors({
    origin: process.env.CLIENT_URL,
    credentials: true,
  })
);
app.use(cookieParser());
app.use(express.json());

app.use("/api/notifications", notificationRoutes);

const io = new Server(httpServer, {
  cors: {
    origin: process.env.CLIENT_URL,
    methods: ["GET", "POST"],
    credentials: true,
  },
});

io.use(socketAuthMiddleware);

io.on("connection", (socket) => {
  const userId = socket.data.userId;
  socket.join(`user:${userId}`);
  console.log(`Client connected: ${socket.id} (user ${userId})`);

  socket.on("subscribe-post", (postId) => {
    if (postId) {
      socket.join(`post:${postId}`);
    }
  });

  socket.on("unsubscribe-post", (postId) => {
    if (postId) {
      socket.leave(`post:${postId}`);
    }
  });

  socket.on("disconnect", () => {
    console.log(`Client disconnected: ${socket.id}`);
  });
});

app.get("/health", (req, res) => {
  res.json({ status: "ok", service: "notification-service" });
});

initEventListener(io);

const PORT = process.env.PORT || 3005;
httpServer.listen(PORT, () => {
  console.log(`Notification service running on port ${PORT}`);
  console.log(`Socket.IO ready (JWT-authenticated connections)`);
});

export { io };
