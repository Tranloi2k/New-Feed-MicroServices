const REQUIRED = [
  "DATABASE_URL",
  "REDIS_URL",
  "RABBITMQ_URL",
  "AUTH_SERVICE_URL",
  "JWT_SECRET",
  "SERVICE_SECRET",
];

export function validateEnv() {
  const missing = REQUIRED.filter((name) => !process.env[name]);
  if (missing.length) {
    throw new Error(`Chat service missing environment variables: ${missing.join(", ")}`);
  }
  for (const name of REQUIRED.filter((key) => key.endsWith("_URL"))) {
    try {
      new URL(process.env[name]);
    } catch {
      throw new Error(`Chat service has invalid URL in ${name}`);
    }
  }
}

export const env = {
  get port() { return Number(process.env.PORT || 3006); },
  get clientUrl() { return process.env.CLIENT_URL || "http://localhost:3000"; },
};
