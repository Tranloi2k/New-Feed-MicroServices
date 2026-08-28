const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL;

export async function getFollowerIds(userId) {
  if (!AUTH_SERVICE_URL || !process.env.SERVICE_SECRET) {
    throw new Error("Auth service integration is not configured");
  }
  const allIds = [];
  let cursor;
  do {
    const url = new URL(`${AUTH_SERVICE_URL}/api/users/internal/${userId}/follower-ids`);
    url.searchParams.set("limit", "500");
    if (cursor) url.searchParams.set("cursor", cursor);
    const response = await fetch(url, {
      headers: { "X-Service-Token": process.env.SERVICE_SECRET },
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) throw new Error("Failed to resolve post recipients");
    const body = await response.json();
    const ids = body.data?.ids;
    if (!Array.isArray(ids) || ids.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
      throw new Error("Auth service returned an invalid recipient contract");
    }
    allIds.push(...ids);
    cursor = body.data?.nextCursor;
  } while (cursor);
  return allIds;
}
