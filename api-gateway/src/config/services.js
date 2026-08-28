import { logger } from "../utils/logger.js";

const REQUIRED_ENV = [
  "JWT_SECRET",
  "SERVICE_SECRET",
  "AUTH_SERVICE_URL",
  "POST_SERVICE_URL",
  "MEDIA_SERVICE_URL",
  "COMMENT_SERVICE_URL",
  "NOTIFICATION_SERVICE_URL",
  "REDIS_URL",
  "CLIENT_URL",
];

export function validateEnv() {
  const missing = REQUIRED_ENV.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(
      `API Gateway missing required environment variables: ${missing.join(", ")}`
    );
  }

  for (const key of REQUIRED_ENV.filter((name) => name.endsWith("_URL"))) {
    try {
      new URL(process.env[key]);
    } catch {
      throw new Error(`API Gateway has invalid URL in ${key}`);
    }
  }
}

export function getTrustProxySetting() {
  const hops = Number(process.env.TRUST_PROXY_HOPS || 0);
  return Number.isSafeInteger(hops) && hops > 0 ? hops : false;
}

export function getServices() {
  return {
    auth: process.env.AUTH_SERVICE_URL,
    post: process.env.POST_SERVICE_URL,
    media: process.env.MEDIA_SERVICE_URL,
    comment: process.env.COMMENT_SERVICE_URL,
    notification: process.env.NOTIFICATION_SERVICE_URL,
  };
}

export function getProxyLogLevel() {
  return process.env.NODE_ENV === "production" ? "warn" : "debug";
}

export function logServiceUrls(services = getServices()) {
  logger.info(`📡 Services:`);
  logger.info(`   - Auth: ${services.auth}`);
  logger.info(`   - Post: ${services.post}`);
  logger.info(`   - Media: ${services.media}`);
  logger.info(`   - Comment: ${services.comment}`);
  logger.info(`   - Notification: ${services.notification}`);
}
