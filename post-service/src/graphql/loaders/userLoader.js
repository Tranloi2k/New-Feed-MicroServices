import DataLoader from "dataloader";
import { getUserById } from "../../services/userService.js";

export function createUserLoader() {
  return new DataLoader(async (userIds) => {
    const users = await Promise.all(userIds.map((id) => getUserById(id)));
    return users;
  });
}
