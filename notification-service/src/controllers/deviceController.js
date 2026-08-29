import {
  registerDeviceToken,
  removeDeviceToken,
  validateDeviceInput,
} from "../services/deviceTokenStore.js";

export async function registerDevice(req, res) {
  const parsed = validateDeviceInput(req.body);
  if (parsed.error) {
    return res.status(400).json({ success: false, message: parsed.error });
  }

  try {
    await registerDeviceToken({
      userId: req.user.userId,
      token: parsed.token,
      platform: parsed.platform,
    });
    return res.status(201).json({ success: true, message: "Device registered" });
  } catch (error) {
    console.error("Device registration failed:", error.message);
    return res.status(500).json({ success: false, message: "Failed to register device" });
  }
}

export async function unregisterDevice(req, res) {
  const parsed = validateDeviceInput(req.body);
  if (parsed.error) {
    return res.status(400).json({ success: false, message: parsed.error });
  }

  try {
    await removeDeviceToken(parsed.token);
    // Deleting an unknown token is not an error: logout must stay idempotent.
    return res.json({ success: true, message: "Device unregistered" });
  } catch (error) {
    console.error("Device removal failed:", error.message);
    return res.status(500).json({ success: false, message: "Failed to unregister device" });
  }
}
