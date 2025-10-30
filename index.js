import express from "express";
import cors from "cors";
import uploadRoutes from "./routes/upload.js";

const app = express();

app.use(cors({ origin: process.env.ALLOW_ORIGIN || "*" }));
app.use(express.json());

// Health check endpoint
app.get("/", (req, res) => {
res.send("✅ Tax Lakay Backend (Email-Only) is running successfully!");
});

// Main API route
app.use("/api", uploadRoutes);

// Port setup for Render
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));

});
