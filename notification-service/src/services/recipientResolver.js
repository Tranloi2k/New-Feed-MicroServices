const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL;

export async function getFollowerIds(userId) {
  if (!AUTH_SERVICE_URL || !process.env.SERVICE_SECRET) {
    throw new Error("Auth service integration is not configured");
  }
  const response = await fetch(
    `${AUTH_SERVICE_URL}/api/users/internal/${userId}/follower-ids`,
    {
      headers: { "X-Service-Token": process.env.SERVICE_SECRET },
      signal: AbortSignal.timeout(3000),
    }
  );
  if (!response.ok) {
    throw new Error("Failed to resolve post recipients");
  }
  const body = await response.json();
  const ids = body.data?.ids;
  if (!Array.isArray(ids) || ids.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
    throw new Error("Auth service returned an invalid recipient contract");
  }
  return ids;
}
