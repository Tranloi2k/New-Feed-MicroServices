import multer from "multer";
import { MAX_FILES, MAX_FILE_SIZE } from "./upload.js";

// Rejected uploads are the caller's mistake, not a server fault: without this
// multer's errors would surface as a bare 500 and explain nothing.
const MULTER_STATUS = {
  LIMIT_FILE_SIZE: 413,
  LIMIT_FILE_COUNT: 400,
  LIMIT_UNEXPECTED_FILE: 400,
};

function uploadLimitMessage(code) {
  const megabytes = Math.round(MAX_FILE_SIZE / (1024 * 1024));
  if (code === "LIMIT_FILE_SIZE") return `Mỗi tệp tối đa ${megabytes}MB.`;
  if (code === "LIMIT_FILE_COUNT") return `Tối đa ${MAX_FILES} tệp mỗi lần tải lên.`;
  return `Chỉ chấp nhận tối đa ${MAX_FILES} tệp trong trường "media".`;
}

export function uploadErrorHandler(err, req, res, _next) {
  // The client is usually still uploading when an upload is rejected. Draining
  // what is left lets this response reach it; without this Node destroys the
  // socket, the caller sees ECONNRESET, and the gateway turns that into a
  // 502/504 with an HTML body instead of the JSON explanation below.
  req.unpipe?.();
  req.resume();

  if (err instanceof multer.MulterError) {
    return res.status(MULTER_STATUS[err.code] || 400).json({
      success: false,
      message: uploadLimitMessage(err.code),
      code: err.code,
    });
  }

  if (!err.status || err.status >= 500) {
    console.error("Media service error:", err);
  }

  res.status(err.status || 500).json({
    success: false,
    message: err.message || "Internal server error",
  });
}
