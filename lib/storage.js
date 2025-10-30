import multer from "multer";
import path from "path";
import fs from "fs";

// Ensure uploads folder exists
const uploadDir = "/tmp/uploads";
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

// Configure file storage
const storage = multer.diskStorage({
destination: function (req, file, cb) {
cb(null, uploadDir);
},
filename: function (req, file, cb) {
const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
cb(null, uniqueSuffix + "-" + file.originalname);
},
});

export const upload = multer({
storage: storage,
limits: { fileSize: 20 * 1024 * 1024, files: 10 }, // 20MB max per file
})
