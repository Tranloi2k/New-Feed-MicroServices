import multer from "multer";

/** 415 tells the caller the file type is the problem, not the server. */
function unsupportedType(message) {
  return Object.assign(new Error(message), { status: 415 });
}


// Multer configuration - store files in memory as Buffer
const storage = multer.memoryStorage();

// Files are held in memory, so these limits are what keeps the pod inside its
// memory budget: at most MAX_FILES * MAX_FILE_SIZE is buffered per request.
export const MAX_FILES = 4;
export const MAX_FILE_SIZE = 8 * 1024 * 1024;

const upload = multer({
  storage: storage,
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: MAX_FILES,
  },
  fileFilter: (req, file, cb) => {
    // Allow images and videos
    const allowedMimes = [
      "image/jpeg",
      "image/jpg",
      "image/png",
      "image/gif",
      "image/webp",
      "video/mp4",
      "video/mpeg",
      "video/quicktime",
      "video/x-msvideo",
    ];

    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(
        unsupportedType(
          "Invalid file type. Only images (JPEG, PNG, GIF, WebP) and videos (MP4, MPEG, MOV) are allowed."
        ),
        false
      );
    }
  },
});

export default upload;
