import fs from "fs";
import express from "express";
import transporter from "../lib/email.js";
import { upload } from "../lib/storage.js";

const router = express.Router();

const OWNER_EMAIL = process.env.OWNER_EMAIL;
const EMAIL_USER = process.env.EMAIL_USER;
const SEND_CLIENT_RECEIPT = (process.env.SEND_CLIENT_RECEIPT || "true").toLowerCase() === "true";

router.post("/upload", upload.array("files", 10), async (req, res) => {
  try {
    if (!req.files?.length) {
      return res.status(400).json({ ok: false, error: "No files received." });
    }
    if (!OWNER_EMAIL || !EMAIL_USER) {
      return res.status(500).json({ ok: false, error: "Server email is not configured." });
    }

    const attachments = req.files.map(f => ({
      filename: f.originalname,
      path: f.path,
      contentType: f.mimetype
    }));

    const clientEmail = (req.body?.email || "").trim();
    const wantsReceipt = String(req.body?.wantsReceipt || "true").toLowerCase() === "true";

    // Email to owner
    await transporter.sendMail({
      from: `"Tax Lakay Upload" <${EMAIL_USER}>`,
      to: OWNER_EMAIL,
      subject: `New document upload (${req.files.length} file${req.files.length>1?"s":""})`,
      text: `New files uploaded.${clientEmail ? " Client: "+clientEmail : ""}`,
      attachments
    });

    // Optional email to client
    if (SEND_CLIENT_RECEIPT && clientEmail && wantsReceipt) {
      await transporter.sendMail({
        from: `"Tax Lakay" <${EMAIL_USER}>`,
        to: clientEmail,
        subject: "We received your documents — Tax Lakay",
        text: "Thanks! Your documents were received. We'll review and contact you shortly."
      });
    }

    // Cleanup temp files (best-effort)
    for (const f of req.files) {
      fs.unlink(f.path, () => {});
    }

    res.json({ ok: true });
  } catch (err) {
    console.error("UPLOAD_ERR:", err?.message || err);
    if (err?.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({ ok: false, error: "Each file must be ≤ 20MB." });
    }
    if (err?.code === "LIMIT_FILE_COUNT") {
      return res.status(413).json({ ok: false, error: "Max 10 files per upload." });
    }
    res.status(500).json({ ok: false, error: "Server failed while processing upload." });
  }
});

export default router;
