// server.js
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const nodemailer = require('nodemailer');
const json = require('./JSON'); // <— your helper above

const app = express();

// CORS (adjust origins if you need)
app.use(cors({
origin: ['https://www.taxlakay.com', 'https://taxlakay.com'],
credentials: true
}));

// Parse JSON for non-multipart routes (optional)
app.use(express.json());

// Multer for file uploads (memory storage)
const upload = multer({
storage: multer.memoryStorage(),
limits: { fileSize: 20 * 1024 * 1024, files: 10 }
});

// Nodemailer transporter
function createTransporter() {
return nodemailer.createTransport({
service: 'gmail',
auth: {
user: process.env.EMAIL_USER || 'lakaytax@gmail.com',
pass: process.env.EMAIL_PASS
}
});
}

// Health GETs
app.get('/', (req, res) => res.json({ ok: true, message: 'TaxLakay API v4 running' }));
app.get('/api/upload', (req, res) =>
res.json({ ok: true, message: '✅ Use POST /api/upload to send files.' })
);

// Upload + email
app.post('/api/upload', upload.array('documents', 10), async (req, res) => {
try {
const ref = 'TL' + Math.floor(100000 + Math.random() * 900000);

// send owner + client email (simplified)
const transporter = createTransporter();
const ownerEmail = process.env.OWNER_EMAIL || 'lakaytax@gmail.com';
const fromEmail = process.env.EMAIL_USER || 'lakaytax@gmail.com';
const clientName = req.body.clientName || 'Client';
const clientEmail = req.body.clientEmail;

// email to owner
await transporter.sendMail({
from: fromEmail,
to: ownerEmail,
subject: `New upload (${ref}) from ${clientName}`,
text: `Ref: ${ref}\nFiles: ${(req.files || []).length}\nEmail: ${clientEmail || ''}`
});

// email to client (optional)
if (clientEmail) {
await transporter.sendMail({
from: fromEmail,
to: clientEmail,
subject: `Tax Lakay – We received your documents (Ref ${ref})`,
text: `Thank you ${clientName}! We received your documents. Your reference number is ${ref}.`
});
}

const payload = {
message: 'Files uploaded successfully! Confirmation email sent.',
filesReceived: (req.files || []).length,
clientEmailSent: !!clientEmail,
ref
};

// 👇 This line keeps the browser on your site if the hidden field is present
return json.ok(res, payload, req.body.stay === '1');
} catch (err) {
console.error(err);
return json.error(res, err.message || 'Upload failed', 500);
}
});

// Start server
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`TaxLakay API v4 listening on ${PORT}`));
