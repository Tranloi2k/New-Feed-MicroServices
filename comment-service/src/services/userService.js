import axios from "axios";

const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL;
// Auth is on the critical path of every comment page; a hung call must not hold
// the GraphQL request open forever.
const REQUEST_TIMEOUT_MS = 3000;

function serviceHeaders() {
  return { "X-Service-Token": process.env.SERVICE_SECRET };
}

/** Shown when auth cannot be reached, so a page of comments still renders. */
export function placeholderUser(userId) {
  return {
    id: userId,
    username: "Unknown",
    email: "unknown@example.com",
    fullName: null,
    avatarUrl: null,
  };
}

export async function getUserById(userId) {
  try {
    const response = await axios.get(
      `${AUTH_SERVICE_URL}/api/internal/users/${userId}`,
      { headers: serviceHeaders(), timeout: REQUEST_TIMEOUT_MS }
    );
    return response.data.data;
  } catch (error) {
    console.error("Error fetching user:", error.message);
    return placeholderUser(userId);
  }
}

/**
 * One request for a whole page of authors. Returns results in the order the ids
 * were asked for, which is what DataLoader requires.
 */
export async function getUsersByIds(userIds) {
  if (!userIds.length) return [];

  try {
    const response = await axios.get(`${AUTH_SERVICE_URL}/api/internal/users`, {
      headers: serviceHeaders(),
      params: { ids: userIds.join(",") },
      timeout: REQUEST_TIMEOUT_MS,
    });

    const byId = new Map(
      (response.data.data || []).map((user) => [user.id, user])
    );
    return userIds.map((id) => byId.get(id) || placeholderUser(id));
  } catch (error) {
    console.error("Error fetching users:", error.message);
    return userIds.map((id) => placeholderUser(id));
  }
}
