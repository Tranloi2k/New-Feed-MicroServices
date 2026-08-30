import DataLoader from "dataloader";
import { getUsersByIds } from "../../services/userService.js";

// Batches every author on a page into a single call to auth-service. The
// previous loader still fired one HTTP request per user.
export function createUserLoader(load = getUsersByIds) {
  return new DataLoader((userIds) => load([...userIds]));
}
