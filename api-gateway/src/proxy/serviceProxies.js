import { createProxyMiddleware } from "http-proxy-middleware";
import { createCircuitBreakerProxy } from "../middleware/circuitBreakerProxy.js";
import {
  attachWsSocketLogging,
  forwardUserHeaders,
  handleProxyError,
  restreamBody,
} from "../utils/proxyHelpers.js";

function forwardIdentityAndJson(proxyReq, req) {
  forwardUserHeaders(proxyReq, req);
  restreamBody(proxyReq, req);
}

function createWebSocketProxy({
  target,
  pathRewrite,
  logLevel,
  label,
  errorMessage,
}) {
  return createProxyMiddleware({
    target,
    changeOrigin: true,
    ws: true,
    logLevel,
    pathRewrite,
    onProxyReq: forwardUserHeaders,
    onProxyReqWs: (proxyReq, req, socket) => {
      forwardUserHeaders(proxyReq, req);
      attachWsSocketLogging(socket, label);
    },
    onError: (error, req, res) => {
      handleProxyError(error, req, res, {
        target,
        message: errorMessage,
      });
    },
  });
}

export function createServiceProxies({ services, logLevel }) {
  const postGraphqlPathRewrite = { "^/graphql/post": "/graphql" };
  const commentGraphqlPathRewrite = { "^/graphql/comment": "/graphql" };

  return {
    authMe: createCircuitBreakerProxy("auth", services.auth, {
      pathRewrite: { "^/api/auth/me": "/api/me" },
      logLevel,
      onProxyReq: forwardUserHeaders,
    }),
    publicAuth: createCircuitBreakerProxy("auth", services.auth, {
      pathRewrite: { "^/api/auth": "/api" },
      logLevel,
      onProxyReq: restreamBody,
    }),
    users: createCircuitBreakerProxy("auth", services.auth, {
      pathRewrite: { "^/api/users": "/api/users" },
      logLevel,
      onProxyReq: forwardIdentityAndJson,
    }),
    postGraphql: createCircuitBreakerProxy("post", services.post, {
      ws: false,
      logLevel,
      pathRewrite: postGraphqlPathRewrite,
      onProxyReq: forwardIdentityAndJson,
    }),
    commentGraphql: createCircuitBreakerProxy("comment", services.comment, {
      ws: false,
      logLevel,
      pathRewrite: commentGraphqlPathRewrite,
      onProxyReq: forwardIdentityAndJson,
    }),
    notifications: createCircuitBreakerProxy(
      "notification",
      services.notification,
      {
        pathRewrite: { "^/api/notifications": "/api/notifications" },
        logLevel,
        onProxyReq: forwardUserHeaders,
      }
    ),
    chat: createCircuitBreakerProxy("chat", services.chat, {
      pathRewrite: { "^/api/chat": "/api/chat" },
      logLevel,
      onProxyReq: forwardIdentityAndJson,
    }),
    media: createCircuitBreakerProxy("media", services.media, {
      pathRewrite: { "^/api/media": "/api/media" },
      logLevel,
      onProxyReq: forwardUserHeaders,
    }),
    comments: createCircuitBreakerProxy("comment", services.comment, {
      pathRewrite: { "^/api/comments": "/api/comments" },
      logLevel,
      onProxyReq: forwardIdentityAndJson,
    }),
    notificationWebSocket: createWebSocketProxy({
      target: services.notification,
      logLevel,
      pathRewrite: (path) =>
        path.replace(/^\/notifications\/socket\.io/, "/socket.io"),
      label: "Notification WS",
      errorMessage: "Notification gateway proxy error",
    }),
    commentGraphqlWebSocket: createWebSocketProxy({
      target: services.comment,
      logLevel,
      pathRewrite: commentGraphqlPathRewrite,
      label: "GraphQL Comment WS",
      errorMessage: "Comment WebSocket gateway proxy error",
    }),
  };
}
