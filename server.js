const path = require('path');
const fs = require('fs');
const express = require('express');
const multer = require('multer');
const cors = require('cors');
const nodemailer = require('nodemailer');
const PDFDocument = require('pdfkit'); // <-- added here (single require)

const app = express();

/* ----------------------------- Middleware ----------------------------- */
app.use(cors({
origin: ['https://www.taxlakay.com', 'https://taxlakay.com', 'http://localhost:3000'],
credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/* --------------------------- Public / Static -------------------------- */
const PUBLIC_DIR = path.join(__dirname, 'public');
if (!fs.existsSync(PUBLIC_DIR)) fs.mkdirSync(PUBLIC_DIR, { recursive: true });

// Serve static files from "public" (logo.png, logs, etc.)
app.use(express.static(PUBLIC_DIR));

/* ------------------------------ CSV Log ------------------------------- */
const LOG_FILE = path.join(PUBLIC_DIR, 'uploads_log.csv');

function csvEscape(v) {
if (v === undefined || v === null) return '""';
const s = String(v).replace(/"/g, '""');
return `"${s}"`;
}

function ensureLogHeader() {
if (!fs.existsSync(LOG_FILE)) {
const header = [
'timestamp',
'ref',
'clientName',
'clientEmail',
'clientPhone',
'returnType',
'dependents',
'filesCount',
'fileNames'
].join(',') + '\n';
fs.writeFileSync(LOG_FILE, header);
}
}
ensureLogHeader();

/* ----------------------------- Multer conf ---------------------------- */
const upload = multer({
storage: multer.memoryStorage(),
limits: {
fileSize: 20 * 1024 * 1024, // 20MB
files: 10
}
});

/* ------------------------- Email transporter -------------------------- */
const createTransporter = () => {
// Using Gmail (App Password recommended)
return nodemailer.createTransport({
service: 'gmail',
auth: {
user: process.env.EMAIL_USER || 'lakaytax@gmail.com',
pass: process.env.EMAIL_PASS
}
});
};

/* -------------------------------- Health ------------------------------ */
app.get('/', (req, res) => {
res.json({ message: 'Tax Lakay Backend is running!', timestamp: new Date().toISOString() });
});
app.get('/health', (req, res) => {
res.json({ status: 'OK', service: 'Tax Lakay Backend' });
});

/* ------------------------------ Upload API ---------------------------- */
// Accept any file field name (handles "documents" or "files")
app.post('/api/upload', upload.any(), async (req, res) => {
try {
console.log('📨 Upload request received');
console.log('Files:', req.files ? req.files.length : 0);
console.log('Body:', req.body);

if (!req.files || req.files.length === 0) {
return res.status(400).json({ ok: false, error: 'No files uploaded' });
}

const {
clientName,
clientEmail,
clientPhone,
returnType,
dependents,
clientMessage,
SEND_CLIENT_RECEIPT
} = req.body;

const sendClientReceipt = SEND_CLIENT_RECEIPT !== 'false';
const referenceNumber = `TL${Date.now().toString().slice(-6)}`;

const transporter = createTransporter();

// 1) Email to YOU (admin)
const adminEmail = {
from: process.env.EMAIL_USER || 'lakaytax@gmail.com',
to: 'lakaytax@gmail.com',
replyTo: clientEmail || undefined,
subject: `📋 New Tax Document Upload - ${clientName || 'Customer'}`,
html: `
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
<h2 style="color: #1e63ff;">📋 New Document Upload Received</h2>

<div style="background: #f8fafc; padding: 15px; border-radius: 8px; margin: 15px 0;">
<h3 style="margin-top: 0;">Client Information:</h3>
<p><strong>Name:</strong> ${clientName || 'Not provided'}</p>
<p><strong>Email:</strong> ${clientEmail ? `<a href="mailto:${clientEmail}">${clientEmail}</a>` : 'Not provided'}</p>
<p><strong>Phone:</strong> ${clientPhone ? `<a href="tel:${clientPhone.replace(/[^0-9+]/g, '')}">${clientPhone}</a>` : 'Not provided'}</p>
<p><strong>Return Type:</strong> ${returnType || 'Not specified'}</p>
<p><strong>Dependents:</strong> ${dependents || '0'}</p>
<p><strong>Files Uploaded:</strong> ${req.files.length} files</p>
<p><strong>Reference #:</strong> ${referenceNumber}</p>
${clientMessage ? `<p><strong>Client Message:</strong> ${clientMessage}</p>` : ''}
</div>

<div style="background: #dcfce7; padding: 10px; border-radius: 5px;">
<p><strong>Files received:</strong></p>
<ul>
${req.files.map(file => `<li>${file.originalname} (${(file.size / 1024 / 1024).toFixed(2)} MB)</li>`).join('')}
</ul>
</div>

<p style="color: #64748b; font-size: 12px; margin-top: 20px;">
Uploaded at: ${new Date().toLocaleString()}
</p>

<hr style="border:none;border-top:1px solid #e5e7eb;margin:16px 0;">
<p style="font-size:13px;color:#475569;margin:0;">
📧 <a href="mailto:lakaytax@gmail.com">lakaytax@gmail.com</a> &nbsp;|&nbsp;
📞 <a href="tel:13179359067">(317) 935-9067</a> &nbsp;|&nbsp;
💻 <a href="https://www.taxlakay.com">www.taxlakay.com</a>
</p>
</div>
`.trim(),
attachments: req.files.map(file => ({
filename: file.originalname,
content: file.buffer,
contentType: file.mimetype
}))
};

// 2) Email to CLIENT
let clientEmailSent = false;
if (clientEmail) {
const clientSubject = "We've Received Your Documents — Tax Lakay";

const clientEmailText = `
Hi ${clientName || 'Valued Customer'},

Thank you so much for choosing Tax Lakay! 🎉
We've received your documents and will start preparing your tax return within the next hour.
If we need any additional information, we'll reach out right away.

Your reference number is ${referenceNumber}.

We appreciate your trust and look forward to helping you get the best refund possible!

Warm regards,
The Tax Lakay Team
📧 lakaytax@gmail.com
📞 (317) 935-9067
💻 https://www.taxlakay.com
`.trim();

const clientEmailHTML = `
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; line-height: 1.6;">
<div style="text-align: center; margin-bottom: 20px;">
<h2 style="color: #1e63ff; margin-bottom: 5px;">We've Received Your Documents</h2>
<p style="color: #64748b; font-size: 16px;">Tax Lakay</p>
</div>

<div style="background: #f0f9ff; padding: 20px; border-radius: 10px; margin: 15px 0;">
<p><strong>Hi ${clientName || 'Valued Customer'},</strong></p>
<p>Thank you so much for choosing Tax Lakay! 🎉</p>
<p>We've received your documents and will start preparing your tax return within the next hour.<br>
If we need any additional information, we'll reach out right away.</p>
<div style="background: #ffffff; padding: 15px; border-radius: 8px; border-left: 4px solid #1e63ff; margin: 15px 0;">
<p style="margin: 0; font-weight: bold;">Your reference number is: <span style="color: #1e63ff;">${referenceNumber}</span></p>
</div>
<p>We appreciate your trust and look forward to helping you get the best refund possible!</p>
</div>

<div style="text-align: center; margin-top: 25px; padding-top: 20px; border-top: 1px solid #e5e7eb;">
<p style="margin: 5px 0; color: #475569;"><strong>Warm regards,</strong><br>The Tax Lakay Team</p>
<p style="margin: 8px 0; color: #64748b;">
📧 <a href="mailto:lakaytax@gmail.com" style="color: #1e63ff;">lakaytax@gmail.com</a> &nbsp;
📞 <a href="tel:3179359067" style="color: #1e63ff;">(317) 935-9067</a><br>
💻 <a href="https://www.taxlakay.com" style="color: #1e63ff;">www.taxlakay.com</a>
</p>
</div>
</div>
`.trim();

const clientEmailOptions = {
from: process.env.EMAIL_USER || 'lakaytax@gmail.com',
to: clientEmail,
subject: clientSubject,
text: clientEmailText,
html: clientEmailHTML
};

if (sendClientReceipt) {
clientEmailOptions.attachments = req.files.map(file => ({
filename: file.originalname,
content: file.buffer,
contentType: file.mimetype
}));
clientEmailOptions.subject = "We've Received Your Documents — Tax Lakay (Files Attached)";
}

try {
await transporter.sendMail(clientEmailOptions);
clientEmailSent = true;
console.log('✅ Client confirmation email sent to:', clientEmail);
console.log('📎 Files attached:', sendClientReceipt);
} catch (emailError) {
console.error('❌ Failed to send client email:', emailError);
}
}

// Send admin email
await transporter.sendMail(adminEmail);
console.log('✅ Admin notification email sent to lakaytax@gmail.com');

// --- CSV log append ---
try {
const ref = referenceNumber; // fixed (was referenceId)
const files = (req.files || []).map(f => f.originalname);
const row = [
new Date().toISOString(),
ref,
req.body.clientName,
req.body.clientEmail,
req.body.clientPhone || '',
req.body.returnType || '',
req.body.dependents || '0',
files.length,
files.join('; ')
].map(csvEscape).join(',') + '\n';

fs.appendFile(LOG_FILE, row, (err) => {
if (err) console.error('CSV append error:', err);
});
} catch (e) {
console.error('CSV logging failed:', e);
}

// Response to frontend
res.json({
ok: true,
message: 'Files uploaded successfully! Confirmation email sent.',
filesReceived: req.files.length,
clientEmailSent: clientEmailSent,
ref: referenceNumber
});

} catch (error) {
console.error('❌ Upload error:', error);
res.status(500).json({ ok: false, error: 'Upload failed: ' + error.message });
}
});

/* --------------------- PDF route for Refund Estimator ------------------- */
app.get('/api/estimator-pdf', (req, res) => {
const {
estimate = '—',
withholding = '0',
kids = '0',
deps = '0',
ts = new Date().toLocaleString(),
dl = '0'
} = req.query;

res.setHeader('Content-Type', 'application/pdf');
const disp = dl === '1' ? 'attachment' : 'inline';
res.setHeader('Content-Disposition', `${disp}; filename="TaxLakay-Estimate.pdf"`);

const doc = new PDFDocument({ size: 'LETTER', margin: 50 });
doc.pipe(res);

// Header bar
doc.rect(0, 0, doc.page.width, 60).fill('#1e63ff');
doc.fillColor('white').fontSize(20).text('TAX LAKAY', 50, 20);
doc.fillColor('white').fontSize(10).text('www.taxlakay.com', 420, 28, { align: 'right' });

// Logo from local /public/logo.png (fix for previous broken path)
const logoPath = path.join(__dirname, 'public', 'logo.png');
if (fs.existsSync(logoPath)) {
doc.image(logoPath, doc.page.width - 120, 15, { width: 60 });
}
doc.moveDown(3);

// Title
doc.fillColor('#1e63ff').fontSize(18).text('Refund Estimate Summary', { align: 'left' });
doc.moveDown(0.5);
doc.fillColor('#111827').fontSize(12).text(`Date & Time: ${ts}`);
doc.moveDown();

// Summary
doc.fontSize(14).fillColor('#111827').text(`Estimated Refund: ${estimate}`);
doc.moveDown(0.5);
doc.fontSize(12)
.text(`Federal withholding: ${withholding}`)
.text(`Qualifying children under 17: ${kids}`)
.text(`Other dependents: ${deps}`);
doc.moveDown();

// Footer / disclaimer
doc.moveDown()
.fontSize(10)
.fillColor('#6b7280')
.text('This is an estimate only based on simplified inputs. Your actual refund may differ after full review.')
.moveDown()
.fillColor('#111827')
.text('Contact: lakaytax@gmail.com');

doc.end();
});

/* -------------------- NEW: Receipt PDF (Server-side) -------------------- */
// Opens a real PDF for iPhone/Google Sites (works with <form target="_blank">)
app.get('/api/receipt-pdf', (req, res) => {
try {
const {
ref = 'TL-' + Date.now(),
files = '1',
service = 'Tax Preparation — $150 Flat',
emailOK = 'Sent',
dateTime = new Date().toLocaleString('en-US', {
year: 'numeric', month: 'long', day: 'numeric',
hour: '2-digit', minute: '2-digit'
})
} = req.query;

res.setHeader('Content-Type', 'application/pdf');
res.setHeader(
'Content-Disposition',
`attachment; filename="TaxLakay_Receipt_${String(ref).replace(/[^A-Za-z0-9_-]/g,'')}.pdf"`
);

const doc = new PDFDocument({ size: 'LETTER', margin: 48 });
doc.pipe(res);

// Header with logo + title
const logoPath = path.join(__dirname, 'public', 'logo.png');
if (fs.existsSync(logoPath)) {
doc.image(logoPath, 48, 36, { width: 80 });
}
doc.fontSize(20).fillColor('#1e63ff').text('Tax Lakay — Upload Receipt', 140, 42);
doc.moveDown(1.2);

// Success badge
doc.roundedRect(48, 90, 90, 24, 12).fill('#10b981');
doc.fillColor('#ffffff').fontSize(12).text('SUCCESS', 63, 96);
doc.fillColor('#111827');

// Note box
doc.moveDown(2);
const note = `Files uploaded successfully! Confirmation email: ${emailOK}.`;
doc.rect(48, 130, doc.page.width - 96, 40).fill('#f0f9ff');
doc.fillColor('#1e63ff').fontSize(12).text(note, 56, 138, { width: doc.page.width - 112 });
doc.fillColor('#111827');

// Details table
const rows = [
['Status', 'Completed'],
['Service', String(service)],
['Files Received', String(files)],
['Email Confirmation', String(emailOK)],
['Reference ID', String(ref)],
['Date & Time', String(dateTime)]
];
let y = 190;
rows.forEach(([k, v]) => {
doc.moveTo(48, y).lineTo(doc.page.width - 48, y).strokeColor('#f1f5f9').stroke();
y += 10;
doc.fillColor('#64748b').fontSize(12).text(k, 48, y);
doc.fillColor('#111827').font('Helvetica-Bold').text(v, 300, y, { align: 'right' });
doc.font('Helvetica');
y += 22;
});
doc.moveTo(48, y).lineTo(doc.page.width - 48, y).strokeColor('#f1f5f9').stroke();

// Footer
doc.moveDown(2);
doc.fillColor('#475569').fontSize(10)
.text('📞 (317) 935-9067 | 🌐 www.taxlakay.com | 📧 lakaytax@gmail.com', { align: 'center' });
doc.fillColor('#94a3b8')
.text(`© ${new Date().getFullYear()} Tax Lakay. All rights reserved.`, { align: 'center' });

doc.end();
} catch (e) {
console.error('PDF error:', e);
res.status(500).json({ error: 'Failed to generate PDF' });
}
});

/* ----------------------------- Start server ---------------------------- */
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
console.log(`🚀 Tax Lakay Backend running on port ${PORT}`);
console.log(`✅ Health check: http://localhost:${PORT}/health`);
});
const ALLOWED_HOSTS = new Set([
'www.taxlakay.com',
'taxlakay.com',
'sites.google.com' // editor & viewer
]);
function isAllowedOrigin(origin) {
if (!origin) return true; // server-to-server, curl, health checks
try {
const { protocol, host } = new URL(origin);
if (protocol !== 'https:') return false;
if (ALLOWED_HOSTS.has(host)) return true;
// Google Sites iframes are served from *.googleusercontent.com
if (/\.googleusercontent\.com$/.test(host)) return true;
return false;
} catch {
return false;
}
}

app.use(cors({
origin: (origin, cb) => cb(null, isAllowedOrigin(origin)),
credentials: true,
methods: ['GET', 'POST', 'OPTIONS'],
allowedHeaders: ['Content-Type', 'Authorization', 'X-Admin-Token'],
maxAge: 86400
}));
app.options('*', cors()); // handle preflight everywhere

/* ------------------------ Progress tracking store ------------------------- */

const PROGRESS_FILE = path.join(PUBLIC_DIR, 'progress.json');

function ensureProgressFile() {
try {
if (!fs.existsSync(PROGRESS_FILE)) {
fs.writeFileSync(PROGRESS_FILE, JSON.stringify({}, null, 2), 'utf8');
}
} catch (e) {
console.error('ensureProgressFile failed:', e);
}
}
ensureProgressFile();

function readProgress() {
try {
const raw = fs.readFileSync(PROGRESS_FILE, 'utf8');
return JSON.parse(raw || '{}');
} catch (e) {
console.error('readProgress failed:', e);
return {};
}
}

function writeProgress(db) {
try {
fs.writeFileSync(PROGRESS_FILE, JSON.stringify(db, null, 2), 'utf8');
return true;
} catch (e) {
console.error('writeProgress failed:', e);
return false;
}
}

// Keep this list in sync with your admin UI
const STAGES = [
'Received',
'In Review',
'Pending Docs',
'50% Complete',
'Ready to File',
'Filed',
'Accepted',
'Rejected',
'Completed'
];

/* ---------------------- Token verify (admin page) ------------------------- */
// Accept token in query or header (X-Admin-Token) for flexibility
app.get('/api/admin/verify', (req, res) => {
const q = (req.query.token || '').trim();
const h = (req.get('X-Admin-Token') || '').trim();
const t = q || h;
if (!t) return res.status(400).json({ ok: false, error: 'Missing token' });
const ok = !!process.env.ADMIN_TOKEN && t === process.env.ADMIN_TOKEN;
return res.json({ ok });
});

/* ------------------ Customer endpoint: check progress --------------------- */
// GET /api/progress?ref=TL123...
app.get('/api/progress', (req, res) => {
const refRaw = (req.query.ref || '').trim();
if (!refRaw) return res.status(400).json({ ok: false, error: 'Missing ref' });

const ref = refRaw.toUpperCase();
const db = readProgress();
const row = db[ref];

if (!row) return res.json({ ok: true, ref, found: false });

return res.json({
ok: true,
ref,
found: true,
status: row.stage,
note: row.note || '',
updatedAt: row.updatedAt
});
});

/* --------------------- Admin endpoint: update progress -------------------- */
// POST /api/admin/progress JSON: { token, ref, stage, note }
app.post('/api/admin/progress', (req, res) => {
try {
const headerToken = (req.get('X-Admin-Token') || '').trim();
const { token: bodyToken, ref, stage, note } = req.body || {};
const token = bodyToken || headerToken;

if (!token || token !== process.env.ADMIN_TOKEN) {
return res.status(401).json({ ok: false, error: 'Unauthorized' });
}
if (!ref || !stage) {
return res.status(400).json({ ok: false, error: 'Missing ref or stage' });
}
if (!STAGES.includes(stage)) {
return res.status(400).json({ ok: false, error: 'Invalid stage' });
}

const key = String(ref).trim().toUpperCase();
const db = readProgress();
db[key] = {
stage,
note: note || '',
updatedAt: new Date().toISOString()
};

if (!writeProgress(db)) {
return res.status(500).json({ ok: false, error: 'Failed to persist' });
}

return res.json({ ok: true, ref: key, stage: db[key].stage, updatedAt: db[key].updatedAt });
} catch (e) {
console.error('admin /progress error:', e);
return res.status(500).json({ ok: false, error: 'Server error' });
}
});

/* -------- Optional: debug endpoint to read progress (token required) ------ */
// GET /api/admin/progress?ref=TL123...
app.get('/api/admin/progress', (req, res) => {
const token = (req.query.token || req.get('X-Admin-Token') || '').trim();
if (!token || token !== process.env.ADMIN_TOKEN) {
return res.status(401).json({ ok: false, error: 'Unauthorized' });
}
const ref = (req.query.ref || '').trim().toUpperCase();
const db = readProgress();
if (ref) return res.json({ ok: true, ref, row: db[ref] || null });
res.json({ ok: true, all: db });
});
