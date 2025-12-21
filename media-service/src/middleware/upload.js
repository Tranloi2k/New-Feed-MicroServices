import multer from "multer";

// Multer configuration - store files in memory as Buffer
const storage = multer.memoryStorage();

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
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
        new Error(
          "Invalid file type. Only images (JPEG, PNG, GIF, WebP) and videos (MP4, MPEG, MOV) are allowed."
        ),
        false
      );
    }
  },
});

export default upload;
