import { uploadToCloudinary } from "../services/cloudinaryService.js";

export async function uploadAvatar(req, res) {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "No avatar file uploaded",
      });
    }

    const result = await uploadToCloudinary(req.file.buffer, {
      folder: "newfeed/avatars",
      resourceType: "image",
      transformation: [
        { width: 400, height: 400, crop: "fill", gravity: "auto" },
        { quality: "auto", fetch_format: "auto" },
      ],
    });

    res.status(200).json({
      success: true,
      message: "Avatar uploaded successfully",
      data: {
        url: result.secure_url,
        publicId: result.public_id,
      },
    });
  } catch (error) {
    console.error("Avatar upload error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to upload avatar",
      error: error.message,
    });
  }
}
