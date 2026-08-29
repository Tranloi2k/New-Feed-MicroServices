import { listMessages } from "../services/messageService.js";

export async function getMessages(req, res, next) {
  try {
    const data = await listMessages(req.user.userId, req.params.id, req.query);
    res.json({ success: true, data });
  } catch (error) { next(error); }
}
