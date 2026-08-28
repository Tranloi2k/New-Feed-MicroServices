import { authenticateUpgrade } from "../middleware/upgradeAuth.js";

export function getWebSocketTarget(pathname) {
  if (
    pathname === "/notifications/socket.io" ||
    pathname.startsWith("/notifications/socket.io/")
  ) {
    return "notification";
  }
  if (pathname === "/graphql/comment") return "comment";
  return null;
}

export function attachWebSocketUpgradeHandler(httpServer, proxies) {
  const handler = (req, socket, head) => {
    const pathname = (req.url || "").split("?")[0];
    const target = getWebSocketTarget(pathname);

    if (!target) {
      socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
      socket.destroy();
      return;
    }

    if (!authenticateUpgrade(req, socket)) return;

    if (target === "notification") {
      proxies.notificationWebSocket.upgrade(req, socket, head);
      return;
    }

    if (req.headers.upgrade?.toLowerCase() !== "websocket") {
      socket.destroy();
      return;
    }
    proxies.commentGraphqlWebSocket.upgrade(req, socket, head);
  };

  httpServer.on("upgrade", handler);
  return () => httpServer.off("upgrade", handler);
}
