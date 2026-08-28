export const rateLimitRules = {
  default: {
    bucket: "default",
    windowMs: 15 * 60 * 1000,
    maxRequests: 100,
    message: "Quá nhiều requests. Vui lòng thử lại sau.",
  },
  auth: {
    login: {
      bucket: "auth:login",
      windowMs: 15 * 60 * 1000,
      maxRequests: 5,
      message: "Quá nhiều lần đăng nhập. Vui lòng thử lại sau 15 phút.",
    },
    signup: {
      bucket: "auth:signup",
      windowMs: 60 * 60 * 1000,
      maxRequests: 3,
      message: "Quá nhiều lần đăng ký. Vui lòng thử lại sau 1 giờ.",
    },
    default: {
      bucket: "auth:default",
      windowMs: 15 * 60 * 1000,
      maxRequests: 20,
      message: "Quá nhiều requests đến auth service. Vui lòng thử lại sau.",
    },
  },
  posts: {
    create: {
      bucket: "posts:create",
      windowMs: 60 * 60 * 1000,
      maxRequests: 10,
      message: "Bạn đã tạo quá nhiều bài viết. Vui lòng thử lại sau 1 giờ.",
    },
    list: {
      bucket: "posts:list",
      windowMs: 60 * 1000,
      maxRequests: 30,
      message: "Quá nhiều requests tải feed. Vui lòng thử lại sau.",
    },
    default: {
      bucket: "posts:default",
      windowMs: 15 * 60 * 1000,
      maxRequests: 50,
      message: "Quá nhiều requests đến post service. Vui lòng thử lại sau.",
    },
  },
  comments: {
    create: {
      bucket: "comments:create",
      windowMs: 15 * 60 * 1000,
      maxRequests: 30,
      message: "Bạn đã comment quá nhiều. Vui lòng thử lại sau.",
    },
    default: {
      bucket: "comments:default",
      windowMs: 15 * 60 * 1000,
      maxRequests: 60,
      message: "Quá nhiều requests đến comment service. Vui lòng thử lại sau.",
    },
  },
  media: {
    upload: {
      bucket: "media:upload",
      windowMs: 60 * 60 * 1000,
      maxRequests: 20,
      message: "Bạn đã upload quá nhiều file. Vui lòng thử lại sau 1 giờ.",
    },
  },
};

function graphqlDocumentContains(body, operationName) {
  const operations = Array.isArray(body) ? body : [body];
  return operations.some((operation) => {
    const document = `${operation?.operationName || ""} ${operation?.query || ""}`;
    return new RegExp(`\\b${operationName}\\b`).test(document);
  });
}

export function getRateLimitRule(path, { method = "GET", body } = {}) {
  if (path === "/api/auth/login") return rateLimitRules.auth.login;
  if (path === "/api/auth/signup") return rateLimitRules.auth.signup;
  if (path.startsWith("/api/auth/")) return rateLimitRules.auth.default;

  if (path === "/graphql/post") {
    if (graphqlDocumentContains(body, "createPost")) {
      return rateLimitRules.posts.create;
    }
    if (
      graphqlDocumentContains(body, "getNewsFeed") ||
      graphqlDocumentContains(body, "getFollowingFeed")
    ) {
      return rateLimitRules.posts.list;
    }
    return rateLimitRules.posts.default;
  }

  if (path === "/graphql/comment") {
    return graphqlDocumentContains(body, "createComment")
      ? rateLimitRules.comments.create
      : rateLimitRules.comments.default;
  }

  if (path.startsWith("/api/comments")) {
    return method === "POST"
      ? rateLimitRules.comments.create
      : rateLimitRules.comments.default;
  }

  if (path.startsWith("/api/media/upload")) {
    return rateLimitRules.media.upload;
  }

  return rateLimitRules.default;
}
