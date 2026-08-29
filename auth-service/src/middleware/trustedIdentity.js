import { isServiceTokenValid } from "./serviceAuth.js";

export function getTrustedIdentity(
  headers = {},
  expectedServiceToken = process.env.SERVICE_SECRET
) {
  if (
    !isServiceTokenValid(headers["x-service-token"], expectedServiceToken)
  ) {
    return null;
  }

  const userId = Number(headers["x-user-id"]);
  if (!Number.isSafeInteger(userId) || userId <= 0) {
    return null;
  }

  return {
    userId,
    email: headers["x-user-email"],
  };
}
