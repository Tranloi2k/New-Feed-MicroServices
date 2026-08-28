import axios from "axios";

const AUTH_SERVICE_URL =
  process.env.AUTH_SERVICE_URL;

export async function getFollowingIds(userId) {
  try {
    const ids = [];
    let cursor;
    do {
      const response = await axios.get(
        `${AUTH_SERVICE_URL}/api/users/internal/${userId}/following-ids`,
        {
          params: { limit: 500, ...(cursor && { cursor }) },
          timeout: 3000,
          headers: {
            "X-Service-Token": process.env.SERVICE_SECRET,
          },
        }
      );
      ids.push(...(response.data.data?.ids ?? []));
      cursor = response.data.data?.nextCursor;
    } while (cursor);
    return ids;
  } catch (error) {
    console.error("Error fetching following ids:", error.message);
    return [];
  }
}

export async function getUserById(userId) {
  try {
    const response = await axios.get(
      `${AUTH_SERVICE_URL}/api/internal/users/${userId}`,
      {
        headers: {
          "X-Service-Token": process.env.SERVICE_SECRET,
        },
      }
    );

    return response.data.data;
  } catch (error) {
    console.error("Error fetching user:", error.message);
    return {
      id: userId,
      username: "Unknown",
      email: "unknown@example.com",
      fullName: null,
      avatarUrl: null,
    };
  }
}
