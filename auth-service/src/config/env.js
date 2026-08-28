const PLACEHOLDER_MARKERS = ["change-this", "your-super-secret", "your-service"];

function requireValue(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export function getBcryptRounds() {
  const rounds = Number(process.env.BCRYPT_ROUNDS || 10);
  if (!Number.isInteger(rounds) || rounds < 10 || rounds > 14) {
    throw new Error("BCRYPT_ROUNDS must be an integer between 10 and 14");
  }
  return rounds;
}

export function validateEnv() {
  requireValue("DATABASE_URL");
  const jwtSecret = requireValue("JWT_SECRET");
  const serviceSecret = requireValue("SERVICE_SECRET");
  requireValue("CLIENT_URL");
  getBcryptRounds();

  const port = Number(process.env.PORT || 3001);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error("PORT must be a valid TCP port");
  }

  if (process.env.NODE_ENV === "production") {
    for (const [name, secret] of [
      ["JWT_SECRET", jwtSecret],
      ["SERVICE_SECRET", serviceSecret],
    ]) {
      if (
        secret.length < 32 ||
        PLACEHOLDER_MARKERS.some((marker) => secret.includes(marker))
      ) {
        throw new Error(`${name} must be a non-placeholder secret of at least 32 characters`);
      }
    }
  }

  return { port };
}
