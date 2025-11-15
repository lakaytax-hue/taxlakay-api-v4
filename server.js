const path = require('path');
const fs = require('fs');
const express = require('express');
const multer = require('multer');
const cors = require('cors');
const nodemailer = require('nodemailer');
const PDFDocument = require('pdfkit');

const app = express();

/* --------------------------- PRIVATE SHEET URL ---------------------------- */
/** Web app URL from your Google Apps Script deployment (Private SSN logger) */
const PRIVATE_SHEET_URL =
'https://script.google.com/macros/s/AKfycbwXTtKQ69cjLaeB7W65Gm5uu5Og4FYcgUU5Lc4evVAUPtYIe72EXQOjoWdB87QZpRwe/exec';

/* ----------------------------- CORS (unified) ----------------------------- */
const ALLOWED_HOSTS = new Set([
'www.taxlakay.com',
'taxlakay.com',
'sites.google.com' // editor & viewer
]);

function isAllowedOrigin(origin) {
if (!origin) return true; // server-to-server, curl, health checks
try {
const u = new URL(origin);
if (u.protocol !== 'https:') return false;
if (ALLOWED_HOSTS.has(u.host)) return true;
// Google Sites iframes are served from *.googleusercontent.com
if (/\.googleusercontent\.com$/i.test(u.host)) return true;
return false;
} catch {
return false;
}
}

app.use(
cors({
origin: (origin, cb) => cb(null, isAllowedOrigin(origin)),
credentials: true,
methods: ['GET', 'POST', 'OPTIONS'],
allowedHeaders: ['Content-Type', 'Authorization', 'X-Admin-Token'],
maxAge: 86400
})
);
app.options('*', cors());

/* ----------------------------- Body parsers ------------------------------- */
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/* --------------------------- Public / Static ------------------------------ */
const PUBLIC_DIR = path.join(__dirname, 'public');
if (!fs.existsSync(PUBLIC_DIR)) fs.mkdirSync(PUBLIC_DIR, { recursive: true });
app.use(express.static(PUBLIC_DIR)); // serve logo.png, logs, etc.

/* ------------------------------ CSV Log ---------------------------------- */
const LOG_FILE = path.join(PUBLIC_DIR, 'uploads_log.csv');

function csvEscape(v) {
if (v === undefined || v === null) return '""';
const s = String(v).replace(/"/g, '""');
return `"${s}"`;
}

function ensureLogHeader() {
if (!fs.existsSync(LOG_FILE)) {
const header =
[
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

/* ----------------------------- Multer conf -------------------------------- */
const upload = multer({
storage: multer.memoryStorage(),
limits: {
fileSize: 20 * 1024 * 1024, // 20MB
files: 10
}
});

/* ------------------------- Email transporter ------------------------------ */
const createTransporter = () => {
// Gmail (App Password recommended)
return nodemailer.createTransport({
service: 'gmail',
auth: {
user: process.env.EMAIL_USER || 'lakaytax@gmail.com',
pass: process.env.EMAIL_PASS
}
});
};

/* ------------------------------ Health ----------------------------------- */
app.get('/', (req, res) => {
res.json({ message: 'Tax Lakay Backend is running!', timestamp: new Date().toISOString() });
});
app.get('/health', (req, res) => {
res.json({ status: 'OK', service: 'Tax Lakay Backend' });
});

/* ---------------------- Admin token reader (unified) ---------------------- */
function readAdminToken(req) {
const h = req.headers['authorization'] || '';
if (h.toLowerCase().startsWith('bearer ')) return h.slice(7).trim();
return (req.get('X-Admin-Token') || req.query.token || req.body?.token || '').trim();
}

/* ---------------------------- Admin: verify token ------------------------- */
app.get('/api/admin/verify', (req, res) => {
const token = readAdminToken(req);
const expected = (process.env.ADMIN_TOKEN || '').trim();
const ok = !!expected && token === expected;
res.json({ ok });
});

/* ------------------------------ Upload API -------------------------------- */
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

// Single source of truth for the reference number
const referenceNumber = `TL${Date.now().toString().slice(-6)}`;

const transporter = createTransporter();

// 1) Email to YOU (admin)
const adminEmail = {
from: process.env.Email_USER || process.env.EMAIL_USER || 'lakaytax@gmail.com',
to: 'lakaytax@gmail.com',
replyTo: clientEmail || undefined,
subject: `📋 New Tax Document Upload - ${clientName || 'Customer'}`,
html: `
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
<h2 style="color: #1e63ff;">📋 New Document Upload Received</h2>

<div style="background: #f8fafc; padding: 15px; border-radius: 8px; margin: 15px 0;">
<h3 style="margin-top: 0;">Client Information:</h3>
<p><strong>Name:</strong> ${clientName || 'Not provided'}</p>
<p><strong>Email:</strong> ${
clientEmail ? `<a href="mailto:${clientEmail}">${clientEmail}</a>` : 'Not provided'
}</p>
<p><strong>Phone:</strong> ${
clientPhone
? `<a href="tel:${clientPhone.replace(/[^0-9+]/g, '')}">${clientPhone}</a>`
: 'Not provided'
}</p>
<p><strong>Return Type:</strong> ${returnType || 'Not specified'}</p>
<p><strong>Dependents:</strong> ${dependents || '0'}</p>
<p><strong>Files Uploaded:</strong> ${req.files.length} files</p>
<p><strong>Reference #:</strong> ${referenceNumber}</p>
${clientMessage ? `<p><strong>Client Message:</strong> ${clientMessage}</p>` : ''}
</div>

<div style="background: #dcfce7; padding: 10px; border-radius: 5px;">
<p><strong>Files received:</strong></p>
<ul>
${req.files
.map(
(file) =>
`<li>${file.originalname} (${(file.size / 1024 / 1024).toFixed(2)} MB)</li>`
)
.join('')}
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
attachments: req.files.map((file) => ({
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
<p style="margin: 0; font-weight: bold;">Your reference number is:
<span style="color: #1e63ff;">${referenceNumber}</span></p>
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
clientEmailOptions.attachments = req.files.map((file) => ({
filename: file.originalname,
content: file.buffer,
contentType: file.mimetype
}));
clientEmailOptions.subject =
"We've Received Your Documents — Tax Lakay (Files Attached)";
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
const ref = referenceNumber;
const files = (req.files || []).map((f) => f.originalname);
const row =
[
new Date().toISOString(),
ref,
req.body.clientName,
req.body.clientEmail,
req.body.clientPhone || '',
req.body.returnType || '',
req.body.dependents || '0',
files.length,
files.join('; ')
]
.map(csvEscape)
.join(',') + '\n';

fs.appendFile(LOG_FILE, row, (err) => {
if (err) console.error('CSV append error:', err);
});
} catch (e) {
console.error('CSV logging failed:', e);
}

// --- Initialize progress for this reference in progress.json ---
try {
const key = String(referenceNumber).trim().toUpperCase();
const db = readProgress();
db[key] = {
stage: 'Received',
note: 'Files uploaded',
updatedAt: new Date().toISOString()
};
writeProgress(db);
} catch (e) {
console.error('progress init failed:', e);
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

/* --------------------- PDF route for Refund Estimator --------------------- */
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
doc
.fontSize(12)
.text(`Federal withholding: ${withholding}`)
.text(`Qualifying children under 17: ${kids}`)
.text(`Other dependents: ${deps}`);
doc.moveDown();

// Footer / disclaimer
doc
.moveDown()
.fontSize(10)
.fillColor('#6b7280')
.text(
'This is an estimate only based on simplified inputs. Your actual refund may differ after full review.'
)
.moveDown()
.fillColor('#111827')
.text('Contact: lakaytax@gmail.com');

doc.end();
});

/* -------------------- Receipt PDF (Server-side) -------------------------- */
app.get('/api/receipt-pdf', (req, res) => {
try {
const {
ref = 'TL-' + Date.now(),
files = '1',
service = 'Tax Preparation — $150 Flat',
emailOK = 'Sent',
dateTime = new Date().toLocaleString('en-US', {
year: 'numeric',
month: 'long',
day: 'numeric',
hour: '2-digit',
minute: '2-digit'
})
} = req.query;

res.setHeader('Content-Type', 'application/pdf');
res.setHeader(
'Content-Disposition',
`attachment; filename="TaxLakay_Receipt_${String(ref).replace(
/[^A-Za-z0-9_-]/g,
''
)}.pdf"`
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
doc
.fillColor('#1e63ff')
.fontSize(12)
.text(note, 56, 138, { width: doc.page.width - 112 });
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
doc
.fillColor('#475569')
.fontSize(10)
.text('📞 (317) 935-9067 | 🌐 www.taxlakay.com | 📧 lakaytax@gmail.com', {
align: 'center'
});
doc
.fillColor('#94a3b8')
.text(`© ${new Date().getFullYear()} Tax Lakay. All rights reserved.`, {
align: 'center'
});

doc.end();
} catch (e) {
console.error('PDF error:', e);
res.status(500).json({ error: 'Failed to generate PDF' });
}
});

/* ------------------- Private Info → Google Sheet logger ------------------- */
/**
* Receives JSON from your secure SSN form and forwards only the needed
* fields to your Private SSN Logger Apps Script.
*
* Required fields:
* - referenceId
* - clientName
* - clientEmail
* - fullSSN OR last4
*
* NOTE: do NOT log fullSSN / last4 in console.
*/
app.post('/api/private-info', async (req, res) => {
try {
const {
referenceId,
clientName,
clientEmail,
clientPhone,
fullSSN,
last4,
language,
service,
source
} = req.body || {};

if (!referenceId || !clientName || !clientEmail) {
return res.status(400).json({
ok: false,
error: 'Missing required fields (name, email, or reference ID)'
});
}
if (!fullSSN && !last4) {
return res
.status(400)
.json({ ok: false, error: 'Missing SSN or last 4 digits' });
}

const payload = {
referenceId: String(referenceId).trim().toUpperCase(),
clientName: clientName || '',
clientEmail: clientEmail || '',
clientPhone: clientPhone || '',
fullSSN: fullSSN || '',
last4: last4 || '',
language: language || 'en',
service: service || 'Tax Preparation — $150 Flat',
source: source || 'SSN Form'
};

// Use global fetch (Node 18+). If your Node is older, install node-fetch.
const sheetResp = await fetch(PRIVATE_SHEET_URL, {
method: 'POST',
headers: { 'Content-Type': 'application/json' },
body: JSON.stringify(payload)
});

const sheetJson = await sheetResp.json().catch(() => ({}));
if (!sheetResp.ok || sheetJson.ok === false) {
throw new Error(sheetJson.error || 'Sheet call failed');
}

return res.json({
ok: true,
message: 'Private information logged securely.'
});
} catch (err) {
console.error('private-info error:', err.message || err);
return res.status(500).json({ ok: false, error: 'Server error' });
}
});

/* ------------------------ Progress tracking store ------------------------ */
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

/* ------------------ Customer: check progress (GET) ------------------------ */
// GET /api/progress?ref=TL123...
app.get('/api/progress', (req, res) => {
const ref = (req.query.ref || '').trim().toUpperCase();
if (!ref) return res.status(400).json({ ok: false, error: 'Missing ref' });
const db = readProgress();
const row = db[ref];
if (!row) return res.json({ ok: true, ref, found: false });
res.json({
ok: true,
ref,
found: true,
status: row.stage,
note: row.note || '',
updatedAt: row.updatedAt
});
});

/* --------------------- Admin: update progress (POST) ---------------------- */
const STAGES = [
// New UI stages
'Received',
'In Progress',
'Awaiting Documents',
'Completed',
'E-Filed',
'IRS Accepted',
// Keep compatibility with older UI
'In Review',
'Pending Docs',
'50% Complete',
'Ready to File',
'Filed',
'Accepted',
'Rejected'
];

function handleAdminUpdate(req, res) {
try {
const token = readAdminToken(req);
if (!token || token !== (process.env.ADMIN_TOKEN || '').trim()) {
return res.status(401).json({ ok: false, error: 'Unauthorized' });
}
const { ref, stage, note } = req.body || {};
if (!ref || !stage)
return res
.status(400)
.json({ ok: false, error: 'Missing ref or stage' });
if (!STAGES.includes(stage))
return res.status(400).json({ ok: false, error: 'Invalid stage' });

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

return res.json({
ok: true,
ref: key,
stage: db[key].stage,
updatedAt: db[key].updatedAt
});
} catch (e) {
console.error('admin update error:', e);
return res.status(500).json({ ok: false, error: 'Server error' });
}
}
app.post('/api/admin/progress', handleAdminUpdate); // legacy path
app.post('/api/admin/update', handleAdminUpdate); // path used by your embed

/* -------- Optional: debug endpoint to read progress (token required) ------ */
// GET /api/admin/progress?ref=TL123...&token=...
app.get('/api/admin/progress', (req, res) => {
const token = readAdminToken(req);
if (!token || token !== (process.env.ADMIN_TOKEN || '').trim()) {
return res.status(401).json({ ok: false, error: 'Unauthorized' });
}
const ref = (req.query.ref || '').trim().toUpperCase();
const db = readProgress();
if (ref) return res.json({ ok: true, ref, row: db[ref] || null });
res.json({ ok: true, all: db });
});

/* ----------------------------- Start server ------------------------------ */
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
console.log(`🚀 Tax Lakay Backend running on port ${PORT}`);
console.log(`✅ Health check: http://localhost:${PORT}/health`);
});
