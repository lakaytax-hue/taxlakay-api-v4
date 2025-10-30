import multer from "multer";

export const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, "/tmp"),
    filename: (_req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
  }),
  limits: {
    files: 10,
    fileSize: 20 * 1024 * 1024 // 20MB per file
  }
});
