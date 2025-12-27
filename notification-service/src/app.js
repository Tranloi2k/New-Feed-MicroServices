import "dotenv/config";
import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { initEventListener } from "./services/eventListener.js";

const app = express();
const httpServer = createServer(app);

// Socket.IO configuration
const io = new Server(httpServer, {
  cors: {
    origin: process.env.CLIENT_URL,
    methods: ["GET", "POST"],
    credentials: true,
  },
});

// Store connected users with their socket IDs
const userSockets = new Map();

io.on("connection", (socket) => {

  console.log(`Client connected: ${socket.id}`);

  // Gửi notification test sau 1s khi client kết nối
  setTimeout(() => {
    socket.emit("notification", {
      id: Date.now().toString(),
      message: "Test notification from server after 1s",
      type: "test",
    });
  }, 1000);

  // User subscribes to their notifications
  socket.on("subscribe", (userId) => {
    if (userId) {
      userSockets.set(userId, socket.id);
      socket.join(`user:${userId}`);
      console.log(`User ${userId} subscribed to notifications`);
    }
  });

  // Subscribe to specific post comments
  socket.on("subscribe-post", (postId) => {
    if (postId) {
      socket.join(`post:${postId}`);
      console.log(`Socket ${socket.id} subscribed to post ${postId}`);
    }
  });

  // Unsubscribe from post
  socket.on("unsubscribe-post", (postId) => {
    if (postId) {
      socket.leave(`post:${postId}`);
      console.log(`Socket ${socket.id} unsubscribed from post ${postId}`);
    }
  });

  socket.on("disconnect", () => {
    // Remove user from map
    for (const [userId, socketId] of userSockets.entries()) {
      if (socketId === socket.id) {
        userSockets.delete(userId);
        break;
      }
    }
    console.log(`Client disconnected: ${socket.id}`);
  });
});

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({ status: "ok", service: "notification-service" });
});

// Initialize RabbitMQ event listener
initEventListener(io);

const PORT = process.env.PORT;
httpServer.listen(PORT, () => {
  console.log(`Notification service running on port ${PORT}`);
  console.log(`Socket.IO ready for connections`);
});

export { io, userSockets };
