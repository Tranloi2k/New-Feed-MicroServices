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

export function getCookieDomain() {
  const domain = process.env.AUTH_COOKIE_DOMAIN?.trim();
  if (!domain) return undefined;
  if (domain.includes("://") || domain.includes("/") || /\s/.test(domain)) {
    throw new Error("AUTH_COOKIE_DOMAIN must be a hostname, not a URL");
  }
  return domain;
}

export function getJwtClaims() {
  const issuer = process.env.JWT_ISSUER?.trim();
  const audience = process.env.JWT_AUDIENCE?.trim();
  if (!issuer || !audience) {
    throw new Error("JWT_ISSUER and JWT_AUDIENCE are required");
  }
  return { issuer, audience };
}

export function validateEnv() {
  requireValue("DATABASE_URL");
  const jwtSecret = requireValue("JWT_SECRET");
  const serviceSecret = requireValue("SERVICE_SECRET");
  requireValue("CLIENT_URL");
  getJwtClaims();
  getBcryptRounds();
  getCookieDomain();

  const port = Number(process.env.PORT || 3001);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error("PORT must be a valid TCP port");
  }

  if (process.env.NODE_ENV === "production") {
    for (const [name, secret] of [
      ["JWT_SECRET", jwtSecret],
      ["SERVICE_SECRET", serviceSecret],
    ]) {
      if (secret.length < 32) {
        throw new Error(`${name} must be at least 32 characters`);
      }
    }

    if (jwtSecret === serviceSecret) {
      throw new Error("JWT_SECRET and SERVICE_SECRET must be different");
    }
  }

  return { port };
}
