const express = require('express');
const cors = require('cors');
const multer = require('multer');
const nodemailer = require('nodemailer');

const app = express();

/* =========================
1) BASIC MIDDLEWARE
========================= */
app.use(cors({
origin: ['https://www.taxlakay.com', 'https://taxlakay.com'],
credentials: true
}));
app.use(express.json());

/* =========================
2) MULTER (UPLOAD) SETUP
========================= */
const upload = multer({
storage: multer.memoryStorage(),
limits: { fileSize: 20 * 1024 * 1024, files: 10 } // 20MB each, up to 10 files
});

/* =========================
3) EMAIL (NODEMAILER)
========================= */
function createTransporter() {
return nodemailer.createTransport({
service: 'gmail',
auth: {
user: process.env.EMAIL_USER || 'lakaytax@gmail.com',
pass: process.env.EMAIL_PASS
}
});
}

/* =========================
4) HEALTH ROUTES
========================= */
app.get('/', (req, res) => {
res.json({
ok: true,
message: 'Tax Lakay Backend is running!',
timestamp: new Date().toISOString()
});
});

app.get('/health', (req, res) => {
res.json({ ok: true, service: 'Tax Lakay Backend' });
});

// Optional: friendly GET to see API is live
app.get('/api/upload', (req, res) => {
res.json({ ok: true, message: '✅ Use POST /api/upload to send files.' });
});

/* =========================
5) UPLOAD + EMAIL + REDIRECT
========================= */
app.post('/api/upload', upload.array('documents', 10), async (req, res) => {
try {
console.log('📨 Upload request received');
console.log('Files:', req.files ? req.files.length : 0);
console.log('Body:', req.body);

if (!req.files || req.files.length === 0) {
return res.status(400).json({ ok: false, error: 'No files uploaded' });
}

// Form fields (keep names in sync with your form)
const {
clientName = 'Client',
clientEmail = '',
clientPhone = '',
clientMessage = ''
} = req.body;

const ref = 'TL' + Math.floor(100000 + Math.random() * 900000);

// Build attachments from memory
const attachments = (req.files || []).map(f => ({
filename: f.originalname,
content: f.buffer,
contentType: f.mimetype
}));

const transporter = createTransporter();
const ownerEmail = process.env.OWNER_EMAIL || 'lakaytax@gmail.com';
const fromEmail = process.env.EMAIL_USER || 'lakaytax@gmail.com';

/* ---- Email to YOU (owner) ---- */
await transporter.sendMail({
from: fromEmail,
to: ownerEmail,
subject: `📥 New Tax Document Upload — ${clientName} (Ref ${ref})`,
text:
`New upload received.

Ref: ${ref}
Name: ${clientName}
Email: ${clientEmail}
Phone: ${clientPhone}

Message:
${clientMessage}

Files: ${(req.files || []).length}`,
attachments
});

/* ---- Email to CLIENT (optional) ---- */
if (clientEmail) {
await transporter.sendMail({
from: fromEmail,
to: clientEmail,
subject: `Tax Lakay — We received your documents (Ref ${ref})`,
text:
`Hello ${clientName},

Thank you for submitting your documents to Tax Lakay.
We’ve received your files and will review them shortly.

Your reference number is: ${ref}

We’ll contact you if anything else is needed.

— Tax Lakay`
});
}

/* ---- IMPORTANT: Redirect back to your site (Option B) ---- */
// Prefer hidden form field "redirect", otherwise use Referer,
// and finally fall back to a thank-you section.
const redirectURL =
req.body.redirect ||
req.get('referer') ||
'https://www.taxlakay.com/#thanks';

return res.redirect(303, redirectURL); // POST-Redirect-GET pattern

} catch (err) {
console.error('Upload failed:', err);
return res.status(500).json({ ok: false, error: 'Upload failed' });
}
});

/* =========================
6) START SERVER
========================= */
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`TaxLakay API v4 listening on ${PORT}`));
