import { uploadMultipleFiles } from "../services/cloudinaryService.js";

/**
 * Upload single hoặc multiple files
 */
const uploadMedia = async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No files uploaded",
      });
    }

    // Upload files lên Cloudinary
    const uploadResults = await uploadMultipleFiles(req.files, {
      folder: "newfeed/posts",
    });

    res.status(200).json({
      success: true,
      message: "Files uploaded successfully",
      data: {
        files: uploadResults,
      },
    });
  } catch (error) {
    console.error("Upload error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to upload files",
      error: error.message,
    });
  }
};

export { uploadMedia };
