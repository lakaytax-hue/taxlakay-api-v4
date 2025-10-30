import express from "express";
import cors from "cors";
import http from "http";
import uploadRoutes from "./routes/upload.js";

const app = express();

// Allow only your website
const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || "https://www.taxlakay.com";
app.use(cors({ origin: ALLOW_ORIGIN }));

// Increase body limits (for forms with metadata)
app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ extended: true, limit: "25mb" }));

// Health check
app.get("/", (_req, res) => res.send("Tax Lakay Backend (Email-Only) — OK"));

// API routes
app.use("/api", uploadRoutes);

// Create HTTP server so we can set timeouts (helps avoid 'Network error' on cold starts)
const server = http.createServer(app);
server.requestTimeout = 120000;   // allow up to 120s for requests
server.headersTimeout = 125000;
server.keepAliveTimeout = 61000;

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log("Server listening on", PORT);
});
