// server.js — TaxLakay API v4 (Email-only uploads)

const express = require('express');
const multer = require('multer');
const cors = require('cors');
const nodemailer = require('nodemailer');

const app = express();

// -------- CORS --------
app.use(cors({
origin: ['https://www.taxlakay.com', 'https://taxlakay.com', 'http://localhost:3000'],
credentials: true
}));
app.use(express.json());

// -------- Multer (in-memory) --------
const upload = multer({
storage: multer.memoryStorage(),
limits: {
fileSize: 20 * 1024 * 1024, // 20MB per file
files: 10
}
});

// ✅ Correct email transporter function
function createTransporter() {
const user = process.env.EMAIL_USER || 'lakaytax@gmail.com';
const pass = process.env.EMAIL_PASS;

if (!user || !pass) {
throw new Error('Missing EMAIL_USER or EMAIL_PASS env vars');
}

const nodemailer = require('nodemailer');
return nodemailer.createTransport({
service: 'gmail',
auth: {
user,
pass
}
});
}

// Optional: verify SMTP at boot so failures show in logs
(async () => {
try {
const t = createTransporter();
await t.verify();
console.log('✅ SMTP ready');
} catch (e) {
console.error('❌ SMTP verify failed:', e.message);
}
})();

// -------- Health & root --------
app.get('/health', (req, res) => {
res.json({ status: 'OK', service: 'TaxLakay API v4', timestamp: new Date().toISOString() });
});

app.get('/', (req, res) => {
res.json({
message: 'Tax Lakay Backend is running!',
timestamp: new Date().toISOString()
});
});

// ---- ✅ Friendly GET for browser checks ----
app.get('/api/upload', (req, res) => {
res.send('✅ TaxLakay API v4 is live — use POST /api/upload to send files.');
});

// ---------- POST /api/upload (main upload handler) ----------
app.post('/api/upload', upload.array('files', 10), async (req, res) => {
try {
console.log('📨 Upload request received');
console.log('Files:', req.files ? req.files.length : 0);
console.log('Body:', req.body);

if (!req.files || req.files.length === 0) {
return res.status(400).json({ ok: false, error: 'No files uploaded' });
}

const transporter = createTransporter();

// Optional client fields if your form sends them
const clientEmail = (req.body.clientEmail || '').trim();
const clientName = (req.body.clientName || '').trim();
const notes = (req.body.notes || '').trim();

// Email to OWNER with attachments
await transporter.sendMail({
from: process.env.EMAIL_USER || 'lakaytax@gmail.com',
to: process.env.OWNER_EMAIL || 'lakaytax@gmail.com',
subject: `New TaxLakay upload (${new Date().toISOString()})`,
text:
`You received ${req.files.length} file(s) from ${clientName || 'a client'}.\n` +
(clientEmail ? `Client email: ${clientEmail}\n` : '') +
(notes ? `Notes: ${notes}\n` : ''),
attachments: req.files.map(f => ({
filename: f.originalname,
content: f.buffer,
contentType: f.mimetype,
})),
});

// Optional: send client a receipt
if (process.env.SEND_CLIENT_RECEIPT === 'true' && clientEmail) {
await transporter.sendMail({
from: process.env.EMAIL_USER || 'lakaytax@gmail.com',
to: clientEmail,
subject: 'We received your documents — Tax Lakay',
text: `Thanks${clientName ? `, ${clientName}` : ''}! We received your document(s). We’ll review and follow up if needed.`,
});
}

return res.json({ ok: true, message: 'Upload successful' });
} catch (err) {
console.error('Upload error:', err);
return res.status(500).json({ ok: false, error: 'Upload failed' });
}
});

// -------- Not found / error handlers (optional) --------
app.use((req, res) => {
res.status(404).json({ ok: false, error: 'Route not found' });
});

// -------- Start server --------
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 TaxLakay API v4 listening on port ${PORT}`));

