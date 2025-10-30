import express from "express";
import cors from "cors";
import uploadRoutes from "./routes/upload.js";

const app = express();

app.use(cors({ origin: process.env.ALLOW_ORIGIN || "*" }));
app.use(express.json());

// Health check
app.get("/", (req, res) => {
res.send("✅ Tax Lakay Backend (Email-Only) is running successfully!");
});

// Optional: API root message
app.get("/api", (req, res) => res.send("API root OK"));

// Main API routes
app.use("/api", uploadRoutes);

// Render port
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
console.log(`✅ Server running on port ${PORT}`);
});
