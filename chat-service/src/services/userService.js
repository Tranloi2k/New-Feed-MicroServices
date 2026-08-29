import axios from "axios";
import { redis } from "../lib/redis.js";

const cacheKey = (id) => `chat:user:${id}`;

export async function getUserById(userId) {
  const cached = await redis.get(cacheKey(userId));
  if (cached) return JSON.parse(cached);
  try {
    const response = await axios.get(`${process.env.AUTH_SERVICE_URL}/api/internal/users/${userId}`, {
      timeout: 3000,
      headers: { "X-Service-Token": process.env.SERVICE_SECRET },
    });
    const user = response.data.data;
    const profile = { userId: user.id, username: user.username, avatarUrl: user.avatarUrl };
    await redis.set(cacheKey(userId), JSON.stringify(profile), { EX: 300 });
    return profile;
  } catch (error) {
    console.error("Chat profile lookup failed:", error.message);
    return { userId, username: "Unknown", avatarUrl: null };
  }
}

export async function getUsersByIds(userIds) {
  const users = await Promise.all(userIds.map(getUserById));
  return new Map(users.map((user) => [user.userId, user]));
}
