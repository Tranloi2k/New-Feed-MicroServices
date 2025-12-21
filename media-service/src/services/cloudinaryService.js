import cloudinary from "../config/cloudinary.js";
import { Readable } from "stream";

/**
 * Upload file lên Cloudinary từ buffer
 * @param {Buffer} fileBuffer - File buffer từ multer
 * @param {Object} options - Cloudinary upload options
 * @returns {Promise<Object>} - Cloudinary upload result
 */
const uploadToCloudinary = (fileBuffer, options = {}) => {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: options.folder || "newfeed",
        resource_type: options.resourceType || "auto",
        transformation: options.transformation || [],
        ...options,
      },
      (error, result) => {
        if (error) {
          reject(error);
        } else {
          resolve(result);
        }
      }
    );

    // Convert buffer to stream và pipe vào Cloudinary
    const readableStream = new Readable();
    readableStream.push(fileBuffer);
    readableStream.push(null);
    readableStream.pipe(uploadStream);
  });
};

/**
 * Upload nhiều files lên Cloudinary
 * @param {Array} files - Array of file objects from multer
 * @param {Object} options - Upload options
 * @returns {Promise<Array>} - Array of Cloudinary URLs
 */
const uploadMultipleFiles = async (files, options = {}) => {
  try {
    const uploadPromises = files.map((file) => {
      // Xác định resource type dựa trên mimetype
      const resourceType = file.mimetype.startsWith("video/")
        ? "video"
        : "image";

      return uploadToCloudinary(file.buffer, {
        ...options,
        resourceType,
        folder: options.folder || "newfeed/posts",
      });
    });

    const results = await Promise.all(uploadPromises);
    return results.map((result) => ({
      url: result.secure_url,
      publicId: result.public_id,
      resourceType: result.resource_type,
      format: result.format,
      width: result.width,
      height: result.height,
      duration: result.duration, // Chỉ có với video
    }));
  } catch (error) {
    throw new Error(`Failed to upload files: ${error.message}`);
  }
};

/**
 * Xóa file khỏi Cloudinary
 * @param {String} publicId - Public ID của file trên Cloudinary
 * @param {String} resourceType - 'image' hoặc 'video'
 * @returns {Promise<Object>}
 */
const deleteFromCloudinary = async (publicId, resourceType = "image") => {
  try {
    const result = await cloudinary.uploader.destroy(publicId, {
      resource_type: resourceType,
    });
    return result;
  } catch (error) {
    throw new Error(`Failed to delete file: ${error.message}`);
  }
};

/**
 * Xóa nhiều files khỏi Cloudinary
 * @param {Array} publicIds - Array of public IDs
 * @param {String} resourceType - 'image' hoặc 'video'
 * @returns {Promise<Object>}
 */
const deleteMultipleFiles = async (publicIds, resourceType = "image") => {
  try {
    const result = await cloudinary.api.delete_resources(publicIds, {
      resource_type: resourceType,
    });
    return result;
  } catch (error) {
    throw new Error(`Failed to delete files: ${error.message}`);
  }
};

export {
  uploadToCloudinary,
  uploadMultipleFiles,
  deleteFromCloudinary,
  deleteMultipleFiles,
};
