import { logger } from "../utils/logger.js";

const REQUIRED_ENV = [
  "JWT_SECRET",
  "AUTH_SERVICE_URL",
  "POST_SERVICE_URL",
  "MEDIA_SERVICE_URL",
  "COMMENT_SERVICE_URL",
  "NOTIFICATION_SERVICE_URL",
];

export function validateEnv() {
  const missing = REQUIRED_ENV.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(
      `API Gateway missing required environment variables: ${missing.join(", ")}`
    );
  }
}

export const SERVICES = {
  auth: process.env.AUTH_SERVICE_URL,
  post: process.env.POST_SERVICE_URL,
  media: process.env.MEDIA_SERVICE_URL,
  comment: process.env.COMMENT_SERVICE_URL,
  notification: process.env.NOTIFICATION_SERVICE_URL,
};

export function getProxyLogLevel() {
  return process.env.NODE_ENV === "production" ? "warn" : "debug";
}

export function logServiceUrls() {
  logger.info(`📡 Services:`);
  logger.info(`   - Auth: ${SERVICES.auth}`);
  logger.info(`   - Post: ${SERVICES.post}`);
  logger.info(`   - Media: ${SERVICES.media}`);
  logger.info(`   - Comment: ${SERVICES.comment}`);
  logger.info(`   - Notification: ${SERVICES.notification}`);
}
