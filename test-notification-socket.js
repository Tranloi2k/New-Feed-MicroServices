const { io } = require("socket.io-client");


const GATEWAY_URL = "ws://localhost:8080";


const socket = io(GATEWAY_URL, {
    transports: ["websocket"],
    path: "/notifications/socket.io",
    reconnectionAttempts: 2,
    timeout: 5000,
});

socket.on("connect", () => {
    console.log("✅ Connected to notification-service via API Gateway");
    // Giữ kết nối 30s để kiểm tra
    setTimeout(() => {
        console.log("⏳ Still connected after 30s");
        process.exit(0);
    }, 30000);
});

socket.on("disconnect", (reason) => {
    console.error("❌ Disconnected:", reason);
    process.exit(1);
});

socket.on("connect_error", (err) => {
    console.error("❌ Connection error:", err.message);
    process.exit(1);
});

setTimeout(() => {
    console.error("❌ Connection timed out");
    process.exit(1);
}, 35000);

socket.on("connect", () => {
    console.log("✅ Connected to notification-service via API Gateway");
    process.exit(0);
});

socket.on("connect_error", (err) => {
    console.error("❌ Connection error:", err.message);
    process.exit(1);
});

setTimeout(() => {
    console.error("❌ Connection timed out");
    process.exit(1);
}, 7000);
