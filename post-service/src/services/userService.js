import axios from "axios";

const AUTH_SERVICE_URL =
  process.env.AUTH_SERVICE_URL;

export async function getFollowingIds(userId) {
  try {
    const response = await axios.get(
      `${AUTH_SERVICE_URL}/api/users/internal/${userId}/following-ids`,
      {
        headers: {
          "X-Service-Token": process.env.SERVICE_SECRET,
        },
      }
    );
    return response.data.data?.ids ?? [];
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
