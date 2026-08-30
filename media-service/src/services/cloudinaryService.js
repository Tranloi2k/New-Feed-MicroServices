import cloudinary from "../config/cloudinary.js";
import { Readable } from "stream";

// Cloudinary must give up before the API Gateway's proxy timeout, so a stalled
// upload fails as a JSON error from this service instead of being cut off
// mid-flight and surfacing as an HTML gateway error.
const CLOUDINARY_TIMEOUT_MS = 45_000;

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
        timeout: CLOUDINARY_TIMEOUT_MS,
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

function formatUploadResult(result) {
  return {
    url: result.secure_url,
    publicId: result.public_id,
    resourceType: result.resource_type,
    format: result.format,
    width: result.width,
    height: result.height,
    duration: result.duration, // Chỉ có với video
  };
}

/**
 * Upload nhiều files lên Cloudinary
 *
 * Uploads run together but settle independently: if any file fails, the ones
 * that already landed are deleted before throwing. Otherwise a partly failed
 * request would leave paid-for files on Cloudinary that no post references.
 *
 * @param {Array} files - Array of file objects from multer
 * @param {Object} options - Upload options
 * @returns {Promise<Array>} - Array of Cloudinary URLs
 */
const uploadMultipleFiles = async (
  files,
  options = {},
  { upload = uploadToCloudinary, remove = deleteFromCloudinary } = {}
) => {
  const settled = await Promise.allSettled(
    files.map((file) =>
      upload(file.buffer, {
        ...options,
        resourceType: file.mimetype.startsWith("video/") ? "video" : "image",
        folder: options.folder || "newfeed/posts",
      })
    )
  );

  const uploaded = settled
    .filter((entry) => entry.status === "fulfilled")
    .map((entry) => formatUploadResult(entry.value));
  const failure = settled.find((entry) => entry.status === "rejected");

  if (!failure) return uploaded;

  await discardUploaded(uploaded, remove);
  throw new Error(
    `Failed to upload files: ${failure.reason?.message || failure.reason}`
  );
};

/** Best-effort cleanup; a failed delete must not mask the original error. */
async function discardUploaded(uploaded, remove) {
  await Promise.allSettled(
    uploaded.map((file) => remove(file.publicId, file.resourceType))
  ).then((results) => {
    for (const result of results) {
      if (result.status === "rejected") {
        console.error("Orphan cleanup failed:", result.reason?.message);
      }
    }
  });
}

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
      timeout: CLOUDINARY_TIMEOUT_MS,
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
      timeout: CLOUDINARY_TIMEOUT_MS,
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
  CLOUDINARY_TIMEOUT_MS,
};
