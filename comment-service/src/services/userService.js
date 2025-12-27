import axios from "axios";

const AUTH_SERVICE_URL =
  process.env.AUTH_SERVICE_URL;

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
    console.error("Error fetching user:", error);
    return {
      id: userId,
      username: "Unknown",
      email: "unknown@example.com",
      fullName: null,
      avatarUrl: null,
    };
  }
}

export async function authenToken(token) {
  try {
    const response = await axios.post(`${AUTH_SERVICE_URL}/api/validate-token`,
      { token },
      {
        headers: {
          "X-Service-Token": process.env.SERVICE_SECRET,
          'Content-Type': 'application/json',
        },
      });
    if (response.status === 200) {
      const { user } = response.data;
      return { valid: true, user };
    }

    return { valid: false, error: 'Invalid token' };
  } catch (error) {
    return { valid: false, error: error.message };
  }
}
