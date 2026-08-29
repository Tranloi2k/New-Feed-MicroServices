import { syncConversations } from "../services/syncService.js";

export async function sync(req, res, next) {
  try {
    res.json(await syncConversations(req.user.userId, req.query.since));
  } catch (error) { next(error); }
}
