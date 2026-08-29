import express from "express";
import cors from "cors";
import compression from "compression";
import cookieParser from "cookie-parser";
import { getProxyLogLevel, getServices, getTrustProxySetting } from "./config/services.js";
import { createRateLimiter } from "./middleware/rateLimiter.js";
import {
  errorHandler,
  notFoundHandler,
} from "./middleware/errorHandlers.js";
import { stripUntrustedIdentityHeaders } from "./utils/proxyHelpers.js";
import { createServiceProxies } from "./proxy/serviceProxies.js";
import { createAuthRoutes } from "./routes/authRoutes.js";
import { createContentRoutes } from "./routes/contentRoutes.js";
import { createGraphqlRoutes } from "./routes/graphqlRoutes.js";
import { createSystemRoutes } from "./routes/systemRoutes.js";
import { createUserRoutes } from "./routes/userRoutes.js";
import { createChatRoutes } from "./routes/chatRoutes.js";

export function createApp({
  proxies,
  rateLimiter,
  clientUrl = process.env.CLIENT_URL,
  trustProxy = getTrustProxySetting(),
} = {}) {
  const app = express();
  const serviceProxies =
    proxies ||
    createServiceProxies({
      services: getServices(),
      logLevel: getProxyLogLevel(),
    });
  const graphqlJson = express.json({ limit: "1mb" });
  const apiJson = express.json({ limit: "64kb" });

  app.set("trust proxy", trustProxy);
  app.use(cors({ origin: clientUrl, credentials: true }));
  app.use(cookieParser());
  app.use(stripUntrustedIdentityHeaders);
  app.use(compression({ level: 6, threshold: 1024 }));

  // GraphQL operations must be parsed before rate limiting so mutations and
  // feed queries can use different buckets. Multipart uploads remain streamed.
  app.use(["/graphql/post", "/graphql/comment"], graphqlJson);
  app.use(rateLimiter || createRateLimiter());

  app.use(createGraphqlRoutes({ proxies: serviceProxies }));
  app.use(createAuthRoutes({ proxies: serviceProxies, jsonParser: apiJson }));
  app.use(createUserRoutes({ proxy: serviceProxies.users, jsonParser: apiJson }));
  app.use(
    createContentRoutes({ proxies: serviceProxies, jsonParser: apiJson })
  );
  app.use(createChatRoutes({ proxies: serviceProxies, jsonParser: apiJson }));
  app.use(createSystemRoutes());

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
