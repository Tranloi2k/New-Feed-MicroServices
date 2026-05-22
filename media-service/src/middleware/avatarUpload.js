import multer from "multer";

const storage = multer.memoryStorage();

const avatarUpload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = [
      "image/jpeg",
      "image/jpg",
      "image/png",
      "image/gif",
      "image/webp",
    ];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(
        new Error(
          "Chỉ chấp nhận ảnh JPEG, PNG, GIF hoặc WebP (tối đa 2MB)."
        ),
        false
      );
    }
  },
});

export default avatarUpload;
