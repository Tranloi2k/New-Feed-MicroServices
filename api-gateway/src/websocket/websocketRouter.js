import { authenticateWebSocketUpgrade } from "../middleware/websocketAuth.js";

export function resolveWebSocketTarget(pathname) {
  if (
    pathname === "/notifications/socket.io" ||
    pathname.startsWith("/notifications/socket.io/")
  ) {
    return "notification";
  }
  if (
    pathname === "/chat/socket.io" ||
    pathname.startsWith("/chat/socket.io/")
  ) {
    return "chat";
  }
  if (pathname === "/graphql/comment") return "comment";
  return null;
}

export function attachWebSocketRouter(httpServer, proxies) {
  const routeConnection = (req, socket, head) => {
    const pathname = (req.url || "").split("?")[0];
    const target = resolveWebSocketTarget(pathname);

    if (!target) {
      socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
      socket.destroy();
      return;
    }

    if (!authenticateWebSocketUpgrade(req, socket)) return;

    if (target === "notification") {
      proxies.notificationWebSocket.upgrade(req, socket, head);
      return;
    }

    if (target === "chat") {
      proxies.chatWebSocket.upgrade(req, socket, head);
      return;
    }

    if (req.headers.upgrade?.toLowerCase() !== "websocket") {
      socket.destroy();
      return;
    }
    proxies.commentGraphqlWebSocket.upgrade(req, socket, head);
  };

  httpServer.on("upgrade", routeConnection);
  return () => httpServer.off("upgrade", routeConnection);
}
