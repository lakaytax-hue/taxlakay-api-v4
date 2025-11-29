const path = require('path');
const fs = require('fs');
const express = require('express');
const multer = require('multer');
const cors = require('cors');
const nodemailer = require('nodemailer');
const PDFDocument = require('pdfkit');
const { google } = require('googleapis');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
const app = express();
/* --------------------------- GOOGLE APPS SCRIPTS -------------------------- */
/** MAIN UPLOAD LOG (Tax Lakay - Upload Log) */
const UPLOAD_SHEET_URL =
'https://script.google.com/macros/s/AKfycbxl0PgbwwQKmyeSn_yeJISZSht8zXBOIcaSeJScrUJK-Ldyv2ekUQLIi6eqMqmaPbVr/exec';

/** PRIVATE SSN LOGGER (Social Security - Upload Log) */
const PRIVATE_SHEET_URL =
'https://script.google.com/macros/s/AKfycby-RtiBJGTPucvcm-HZEJtkL05mMcWSGaezfBcjA0IdLuGLpstSPbQiBQXW7hs8DsCkGA/exec';

/** BANK INFO LOG (Bank Info – Upload Log) */
const BANK_SHEET_URL =
process.env.BANK_SHEET_URL ||
'https://script.google.com/macros/s/AKfycby-vgK1j7Uj7JIMpNuxl8StMIa869-KXxDO9yGNRufdj_YDE7ocunX_PAwtwgs2kZjr/exec';/* --------------------------- Google Drive Setup --------------------------- */
const DRIVE_PARENT_FOLDER_ID =
process.env.GOOGLE_DRIVE_PARENT_FOLDER_ID ||
'16tx8uhyrq79K481-2Ey1SZz-ScRb5EJh';

let drive = null;

(function initDrive() {
try {
const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const rawKey = process.env.GOOGLE_PRIVATE_KEY || '';

if (!clientEmail || !rawKey || !DRIVE_PARENT_FOLDER_ID) {
console.warn('  Google Drive not fully configured. Skipping Drive uploads.');
return;
}

const privateKey = rawKey.replace(/\\n/g, '\n');

const auth = new google.auth.JWT(
clientEmail,
null,
privateKey,
['https://www.googleapis.com/auth/drive.file']
);

drive = google.drive({ version: 'v3', auth });
console.log('  Google Drive client initialized');
} catch (e) {
console.error('  Failed to init Google Drive client:', e);
drive = null;
}
})();

/* Small helpers for Drive names */
function sanitizeName(str) {
if (!str) return '';
return String(str).replace(/[<>:"/\\|?*]+/g, '').trim();
}

async function ensureClientFolder(ref, clientName, clientPhone) {
if (!drive || !DRIVE_PARENT_FOLDER_ID) return null;

const safeRef = sanitizeName(ref);
const safeName = sanitizeName(clientName || 'Client');
const safePhone = sanitizeName(clientPhone || '');

let folderName = `${safeRef} - ${safeName}`;
if (safePhone) folderName += ` - ${safePhone}`;

try {
const listRes = await drive.files.list({
q: `'${DRIVE_PARENT_FOLDER_ID}' in parents and mimeType = 'application/vnd.google-apps.folder' and name = '${folderName.replace(/'/g, "\\'")}' and trashed = false`,
fields: 'files(id, name)',
pageSize: 1
});

if (listRes.data.files && listRes.data.files.length > 0) {
return listRes.data.files[0].id;
}

const createRes = await drive.files.create({
requestBody: {
name: folderName,
mimeType: 'application/vnd.google-apps.folder',
parents: [DRIVE_PARENT_FOLDER_ID]
},
fields: 'id'
});

console.log(`  Created Drive folder for ${ref}: ${folderName}`);
return createRes.data.id;
} catch (e) {
console.error('  ensureClientFolder failed:', e);
return null;
}
}

async function uploadFilesToDrive(folderId, files, meta = {}) {
if (!drive || !folderId || !Array.isArray(files) || files.length === 0) return;

for (const file of files) {
try {
const fileName = sanitizeName(file.originalname) || 'document';
const res = await drive.files.create({
requestBody: {
name: fileName,
parents: [folderId],
description: `TaxLakay upload — Ref: ${meta.ref || ''}, Name: ${
meta.clientName || ''
}, Email: ${meta.clientEmail || ''}`
},
media: {
mimeType: file.mimetype,
body: Buffer.isBuffer(file.buffer)
? require('stream').Readable.from(file.buffer)
: file.buffer
},
fields: 'id, name'
});
console.log(`  Uploaded to Drive: ${res.data.name} (${res.data.id})`);
} catch (e) {
console.error('  Failed to upload file to Drive:', e);
}
}
}

/* ---------------- USPS ADDRESS VALIDATION HELPER ------------------------- */
async function verifyAddressWithUSPS(rawAddress) {
try {
const userId = process.env.USPS_USER_ID;
if (!userId || !rawAddress) return null;

const parts = String(rawAddress).split(',');
if (parts.length < 3) return null;

const street = (parts[0] || '').trim();
const city = (parts[1] || '').trim();
const stateZip = (parts[2] || '').trim().split(/\s+/);
const state = stateZip[0] || '';
const zip5 = (stateZip[1] || '').slice(0, 5) || '';

if (!street || !city || !state || !zip5) return null;

const xml =
`<AddressValidateRequest USERID="${userId}">` +
`<Revision>1</Revision>` +
`<Address ID="0">` +
`<Address1></Address1>` +
`<Address2>${street}</Address2>` +
`<City>${city}</City>` +
`<State>${state}</State>` +
`<Zip5>${zip5}</Zip5>` +
`<Zip4></Zip4>` +
`</Address>` +
`</AddressValidateRequest>`;

const url =
'https://secure.shippingapis.com/ShippingAPI.dll?API=Verify&XML=' +
encodeURIComponent(xml);

const resp = await fetch(url);
const text = await resp.text();

if (text.includes('<Error>')) {
console.warn('USPS returned error for address:', rawAddress);
return null;
}

function pick(tag) {
const m = text.match(new RegExp(`<${tag}>([^<]*)</${tag}>`, 'i'));
return m ? m[1].trim() : '';
}

const addr2 = pick('Address2');
const cityResult = pick('City');
const stateResult = pick('State');
const zip5Result = pick('Zip5');

if (!addr2 || !cityResult || !stateResult || !zip5Result) return null;

const formatted = `${addr2}, ${cityResult}, ${stateResult} ${zip5Result}`;
return { formatted };
} catch (e) {
console.error('USPS verifyAddressWithUSPS failed:', e);
return null;
}
}

/* ----------------------------- CORS (unified) ----------------------------- */
const ALLOWED_HOSTS = new Set([
'www.taxlakay.com',
'taxlakay.com',
'sites.google.com'
]);

function isAllowedOrigin(origin) {
if (!origin) return true;
try {
const u = new URL(origin);
if (u.protocol !== 'https:') return false;
if (ALLOWED_HOSTS.has(u.host)) return true;
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
app.use(express.static(PUBLIC_DIR));

/* ------------------------- Email template loader -------------------------- */
const EMAIL_DIR = path.join(__dirname, 'emails');

function loadTemplateForLang(lang) {
const map = {
en: 'eng.html',
es: 'es.html',
ht: 'ht.html'
};
const file = map[lang] || map.en;
try {
const filePath = path.join(EMAIL_DIR, file);
if (!fs.existsSync(filePath)) {
console.warn(`  Email template not found: ${filePath}`);
return null;
}
return fs.readFileSync(filePath, 'utf8');
} catch (E) {
console.error('  Failed to load email template:', E);
return null;
}
}

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

/* -------- Helper: CSV parsing + look up client by reference ID ------------ */
function parseCsvLine(line) {
const result = [];
let cur = '';
let inQuotes = false;
for (let i = 0; i < line.length; i++) {
const ch = line[i];
if (ch === '"') {
if (inQuotes && line[i + 1] === '"') {
cur += '"';
i++;
} else {
inQuotes = !inQuotes;
}
} else if (ch === ',' && !inQuotes) {
result.push(cur);
cur = '';
} else {
cur += ch;
}
}
result.push(cur);
return result;
}

function findClientByRef(ref) {
try {
if (!fs.existsSync(LOG_FILE)) return null;
const raw = fs.readFileSync(LOG_FILE, 'utf8');
const lines = raw.trim().split('\n');
if (lines.length <= 1) return null;

for (let i = lines.length - 1; i >= 1; i--) {
const cols = parseCsvLine(lines[i]);
const rowRef = (cols[1] || '').replace(/^"|"$/g, '');
if (rowRef.toUpperCase() === ref.toUpperCase()) {
const name = (cols[2] || '').replace(/^"|"$/g, '');
const email = (cols[3] || '').replace(/^"|"$/g, '');
const phone = (cols[4] || '').replace(/^"|"$/g, '');
return { name, email, phone };
}
}
return null;
} catch (e) {
console.error('findClientByRef failed:', e);
return null;
}
}

/* ------------------ VALIDATE REFERENCE ID (FRONT-END CHECK) -------------- */
app.post('/api/validate-reference', express.json(), (req, res) => {
try {
const { referenceId } = req.body || {};
if (!referenceId) {
return res.json({ ok: false, message: "Reference ID is required." });
}

const ref = String(referenceId).trim().toUpperCase();

//   Correct format: TL + 6 digits (e.g., TL929402)
const pattern = /^TL\d{6}$/;

if (!pattern.test(ref)) {
return res.json({
ok: false,
message: "Please enter a valid Reference ID from your Tax Lakay upload receipt."
});
}

//   Only accept IDs that actually exist in uploads_log.csv
const match = findClientByRef(ref);
if (!match) {
return res.json({
ok: false,
message: "Unable to verify your Reference ID. Please double-check your upload receipt."
});
}

// VALID
return res.json({ ok: true, message: "Reference ID verified." });

} catch (err) {
console.error("Validation error:", err);
return res.json({ ok: false, message: "Server error validating Reference ID." });
}
});

/* ----------------------------- Multer conf -------------------------------- */
const upload = multer({
storage: multer.memoryStorage(),
limits: {
fileSize: 20 * 1024 * 1024,
files: 10
}
});

/* ------------------------- Email transporter ------------------------------ */
const createTransporter = () => {
return nodemailer.createTransport({
service: 'gmail',
auth: {
user: process.env.Email_USER || process.env.EMAIL_USER || 'lakaytax@gmail.com',
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
app.post('/api/upload', upload.any(), async (req, res) => {
try {
console.log('  Upload request received');
console.log('Files:', req.files ? req.files.length : 0);
console.log('Body:', req.body);

if (!req.files || req.files.length === 0) {
return res.status(400).json({ ok: false, error: 'No files uploaded' });
}

const {
clientName,
clientEmail,
clientPhone,
clientAddress, // legacy field
currentAddress, // NEW preferred field
returnType,
dependents,
clientMessage,
SEND_CLIENT_RECEIPT,
clientLanguage,
cashAdvance, // NEW
refundMethod // NEW
} = req.body;

const lang = ['en', 'es', 'ht'].includes((clientLanguage || '').toLowerCase())
? clientLanguage.toLowerCase()
: 'en';

const sendClientReceipt = SEND_CLIENT_RECEIPT !== 'false';

const referenceNumber = `TL${Date.now().toString().slice(-6)}`;

const addressForUsps = currentAddress || clientAddress || '';

/* === Optional USPS validate for upload address (admin info only) ===== */
let uploadUspsSuggestion = null;
try {
if (addressForUsps && process.env.USPS_USER_ID) {
uploadUspsSuggestion = await verifyAddressWithUSPS(addressForUsps);
}
} catch (e) {
console.error('  USPS validation for upload form failed:', e);
}

/* === Google Drive upload (non-blocking on failure) ==================== */
try {
const folderId = await ensureClientFolder(referenceNumber, clientName, clientPhone);
if (folderId) {
await uploadFilesToDrive(folderId, req.files, {
ref: referenceNumber,
clientName,
clientEmail
});
} else {
console.warn(`  No Drive folder created for ref ${referenceNumber}`);
}
} catch (e) {
console.error('  Drive upload block failed:', e);
}

/* === Upload Log → Apps Script (now with new fields) =================== */
try {
const sheetPayload = {
timestamp, // Timestamp,referenceId, // Reference ID,clientName, // Client Name,clientEmail, // Client Email,clientPhone, // Client Phone,service, // Service,returnType, // Return Type,dependents, // Dependents,cashAdvance, // Cash Advance (string or amount),refundMethod, // Refund Method,currentAddress, // Current Address,filesCell, // Files,source, // Source,last4Id, // Last 4 ID,isPrivate, // Private,preferredLanguage, // Preferred Language,message // Message,});const r = await fetch(UPLOAD_SHEET_URL, {method: 'POST',
headers: { 'Content-Type': 'application/json' },
body: JSON.stringify(sheetPayload)
});

const j = await r.json().catch(() => ({}));
if (!r.ok || (j && j.ok === false)) {
console.error('  Upload Sheet logger error:', j && j.error);
} else {
console.log('  Row logged to Tax Lakay - Upload Log');
}
} catch (e) {
console.error('  Failed calling Upload Sheet logger:', e);
}

const transporter = createTransporter();

/* ---------------- Email to YOU (admin) ---------------- */
const adminTo =
process.env.OWNER_EMAIL ||
process.env.EMAIL_USER ||
'lakaytax@gmail.com';

const adminEmail = {
from: process.env.EMAIL_USER || 'lakaytax@gmail.com',
to: adminTo,
replyTo: clientEmail || undefined,
subject: `  New Tax Document Upload - ${clientName || 'Customer'}`,
html: `
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
<h2 style="color: #1e63ff;">  New Document Upload Received</h2>

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
<p><strong>Address (client):</strong> ${currentAddress || clientAddress || 'Not provided'}</p>
${
uploadUspsSuggestion && uploadUspsSuggestion.formatted
? `<p><strong>USPS suggested:</strong> ${uploadUspsSuggestion.formatted}</p>`
: ''
}
<p><strong>Cash Advance:</strong> ${cashAdvance || 'Not specified'}</p>
<p><strong>Refund Method:</strong> ${refundMethod || 'Not specified'}</p>
<p><strong>Files Uploaded:</strong> ${req.files.length} files</p>
<p><strong>Reference #:</strong> ${referenceNumber}</p>
${clientMessage ? `<p><strong>Client Message:</strong> ${clientMessage}</p>` : ''}
</div>

<div style="background: #dcfce7; padding: 10px; border-radius: 5px;">
<p><strong>Files received:</strong></p>
<ul>
${
req.files
.map(
file =>
`<li>${file.originalname} (${(file.size / 1024 / 1024).toFixed(2)} MB)</li>`
)
.join('')
}
</ul>
</div>

<p style="color: #64748b; font-size: 12px; margin-top: 20px;">
Uploaded at: ${new Date().toLocaleString()}
</p>

<hr style="border:none;border-top:1px solid #e5e7eb;margin:16px 0;">
<p style="font-size:13px;color:#475569;margin:0;">
  <a href="mailto:lakaytax@gmail.com">lakaytax@gmail.com</a> &nbsp;|&nbsp;
  <a href="tel:13179359067">(317) 935-9067</a> &nbsp;|&nbsp;
  <a href="https://www.taxlakay.com">www.taxlakay.com</a>
</p>
</div>
`.trim(),
attachments: req.files.map(file => ({
filename: file.originalname,
content: file.buffer,
contentType: file.mimetype
}))
};

/* ---------------- Email to CLIENT (templates) ---------------- */
let clientEmailSent = false;
if (clientEmail) {
const clientSubject = "We've Received Your Documents — Tax Lakay";

const clientEmailText = `
Hi ${clientName || 'Valued Customer'},

Thank you so much for choosing Tax Lakay!  
We've received your documents and will start preparing your tax return shortly.
If we need any additional information, we'll reach out right away.

Your reference number is ${referenceNumber}.

You can check your filing status anytime using your Reference ID at:
https://www.taxlakay.com/filing-status

Warm regards,
The Tax Lakay Team
  lakaytax@gmail.com
  (317) 935-9067
  https://www.taxlakay.com
`.trim();

let clientEmailHTML = null;
try {
const tpl = loadTemplateForLang(lang);
if (tpl) {
clientEmailHTML = tpl
.replace(/{{client_name}}/g, clientName || 'Valued Customer')
.replace(/{{ref_number}}/g, referenceNumber);
}
} catch (e) {
console.error('  Error applying email template:', e);
}

if (!clientEmailHTML) {
clientEmailHTML = `
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; line-height: 1.6;">
<div style="text-align: center; margin-bottom: 20px;">
<h2 style="color: #1e63ff; margin-bottom: 5px;">We've Received Your Documents</h2>
<p style="color: #64748b; font-size: 16px;">Tax Lakay</p>
</div>

<div style="background: #f0f9ff; padding: 20px; border-radius: 10px; margin: 15px 0;">
<p><strong>Hi ${clientName || 'Valued Customer'},</strong></p>
<p>Thank you so much for choosing Tax Lakay!  </p>
<p>We've received your documents and will start preparing your tax return shortly.<br>
If we need any additional information, we'll reach out right away.</p>

<div style="background: #ffffff; padding: 15px; border-radius: 8px; border-left: 4px solid #1e63ff; margin: 15px 0;">
<p style="margin: 0; font-weight: bold;">Your reference number is:
<span style="color: #1e63ff;">${referenceNumber}</span></p>
</div>

<p>You can check your filing status anytime using your Reference ID at
<a href="https://www.taxlakay.com/filing-status" style="color:#1e63ff;">
https://www.taxlakay.com/filing-status
</a>.
</p>
</div>

<div style="text-align: center; margin-top: 25px; padding-top: 20px; border-top: 1px solid #e5e7eb;">
<p style="margin: 5px 0; color: #475569;"><strong>Warm regards,</strong><br>The Tax Lakay Team</p>
<p style="margin: 8px 0; color: #64748b;">
  <a href="mailto:lakaytax@gmail.com" style="color: #1e63ff;">lakaytax@gmail.com</a> &nbsp;
  <a href="tel:3179359067" style="color: #1e63ff;">(317) 935-9067</a><br>
  <a href="https://www.taxlakay.com" style="color: #1e63ff;">www.taxlakay.com</a>
</p>
</div>
</div>
`.trim();
}

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
clientEmailOptions.subject =
"We've Received Your Documents — Tax Lakay (Files Attached)";
}

try {
await transporter.sendMail(clientEmailOptions);
clientEmailSent = true;
console.log('  Client confirmation email sent to:', clientEmail);
console.log('  Files attached:', sendClientReceipt);
} catch (emailError) {
console.error('  Failed to send client email:', emailError);
}
}

await transporter.sendMail(adminEmail);
console.log('  Admin notification email sent to', adminTo);

/* ------------- CSV log append ------------- */
try {
const ref = referenceNumber;
const files = (req.files || []).map(f => f.originalname);
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

fs.appendFile(LOG_FILE, row, err => {
if (err) console.error('CSV append error:', err);
});
} catch (e) {
console.error('CSV logging failed:', e);
}

/* ------------- Initialize progress.json ------------- */
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

res.json({
ok: true,
message: 'Files uploaded successfully! Confirmation email sent.',
filesReceived: req.files.length,
clientEmailSent,
ref: referenceNumber,
clientAddress: addressForUsps || '',
uspsSuggestedAddress: uploadUspsSuggestion?.formatted || null
});
} catch (error) {
console.error('  Upload error:', error);
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

doc.rect(0, 0, doc.page.width, 60).fill('#1e63ff');
doc.fillColor('white').fontSize(20).text('TAX LAKAY', 50, 20);
doc.fillColor('white').fontSize(10).text('www.taxlakay.com', 420, 28, { align: 'right' });

const logoPath = path.join(__dirname, 'public', 'logo.png');
if (fs.existsSync(logoPath)) {
doc.image(logoPath, doc.page.width - 120, 15, { width: 60 });
}
doc.moveDown(3);

doc.fillColor('#1e63ff').fontSize(18).text('Refund Estimate Summary', { align: 'left' });
doc.moveDown(0.5);
doc.fillColor('#111827').fontSize(12).text(`Date & Time: ${ts}`);
doc.moveDown();

doc.fontSize(14).fillColor('#111827').text(`Estimated Refund: ${estimate}`);
doc.moveDown(0.5);
doc
.fontSize(12)
.text(`Federal withholding: ${withholding}`)
.text(`Qualifying children under 17: ${kids}`)
.text(`Other dependents: ${deps}`);
doc.moveDown();

doc
.moveDown()
.fontSize(10)
.fillColor('#6b7280')
.text(
'This is an estimate only based on simplified inputs. Your actual refund may differ after full review.'
)
.moveDown()
.fillColor('#111827')
.text('Contact: lakaytax@gmail.com');

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
`attachment; filename="TaxLakay_Receipt_${String(ref).replace(/[^A-Za-z0-9_-]/g, '')}.pdf"`
);

const doc = new PDFDocument({ size: 'LETTER', margin: 48 });
doc.pipe(res);

const logoPath = path.join(__dirname, 'public', 'logo.png');
if (fs.existsSync(logoPath)) {
doc.image(logoPath, 48, 36, { width: 80 });
}
doc.fontSize(20).fillColor('#1e63ff').text('Tax Lakay — Upload Receipt', 140, 42);
doc.moveDown(1.2);

doc.roundedRect(48, 90, 90, 24, 12).fill('#10b981');
doc.fillColor('#ffffff').fontSize(12).text('SUCCESS', 63, 96);
doc.fillColor('#111827');

doc.moveDown(2);
const note = `Files uploaded successfully! Confirmation email: ${emailOK}.`;
doc.rect(48, 130, doc.page.width - 96, 40).fill('#f0f9ff');
doc
.fillColor('#1e63ff')
.fontSize(12)
.text(note, 56, 138, { width: doc.page.width - 112 });
doc.fillColor('#111827');

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

doc
.moveDown(2)
.fillColor('#475569')
.fontSize(10)
.text('  (317) 935-9067 |   www.taxlakay.com |   lakaytax@gmail.com', {
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

/* ---------------------- PRIVATE SSN /info endpoint ----------------------- */
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

const normRef = String(referenceId).trim().toUpperCase();
const logMatch = findClientByRef(normRef);
const refStatus = logMatch ? 'MATCHED' : 'NO_MATCH';

const payload = {
referenceId: normRef,
clientName: clientName || '',
clientEmail: clientEmail || '',
clientPhone: clientPhone || '',
fullSSN: fullSSN || '',
last4: last4 || '',
language: language || 'en',
service: service || 'Tax Preparation — $150 Flat',
source: source || 'SSN Form',
refStatus,
logName: logMatch?.name || '',
logEmail: logMatch?.email || '',
logPhone: logMatch?.phone || ''
};

const sheetResp = await fetch(PRIVATE_SHEET_URL, {
method: 'POST',
headers: { 'Content-Type': 'application/json' },
body: JSON.stringify(payload)
});

const sheetJson = await sheetResp.json().catch(() => ({}));
if (!sheetResp.ok || sheetJson.ok === false) {
throw new Error(sheetJson.error || 'Sheet call failed');
}

try {
const transporter = createTransporter();
const safeLast4 =
last4 ||
(typeof fullSSN === 'string' && fullSSN.length >= 4
? fullSSN.slice(-4)
: '');

const subject = 'New Social Security Form Submitted — Tax Lakay';

const text = `
New Social Security form submitted.

Name: ${clientName || 'N/A'}
Email: ${clientEmail || 'N/A'}
Phone: ${clientPhone || 'N/A'}
Reference ID: ${normRef}
Last 4 of SSN: ${safeLast4 || 'N/A'}
Language: ${language || 'en'}
Match with Upload Log: ${refStatus}

(Full SSN is NOT included in this email for security reasons.)
`.trim();

const html = `
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; line-height: 1.6;">
<h2 style="color:#1e63ff;margin-bottom:8px;">New Social Security Form Submitted</h2>
<p style="margin:4px 0;"><strong>Name:</strong> ${clientName || 'N/A'}</p>
<p style="margin:4px 0;"><strong>Email:</strong> ${
clientEmail
? `<a href="mailto:${clientEmail}" style="color:#1e63ff;">${clientEmail}</a>`
: 'N/A'
}</p>
<p style="margin:4px 0;"><strong>Phone:</strong> ${
clientPhone
? `<a href="tel:${clientPhone.replace(/[^0-9+]/g, '')}" style="color:#1e63ff;">${clientPhone}</a>`
: 'N/A'
}</p>
<p style="margin:4px 0;"><strong>Reference ID:</strong> <span style="font-family:monospace;">${normRef}</span></p>
<p style="margin:4px 0;"><strong>Last 4 of SSN:</strong> ${safeLast4 || 'NA'}</p>
<p style="margin:4px 0;"><strong>Preferred Language:</strong> ${language || 'en'}</p>
<p style="margin:4px 0;"><strong>Match with Upload Log:</strong> ${refStatus}</p>

<p style="margin-top:12px;font-size:12px;color:#64748b;">
Full SSN is <strong>not</strong> included in this email and is stored only in your
private, access-restricted system (Social Security – Upload Log sheet).
</p>
</div>
`.trim();

await transporter.sendMail({
from: process.env.EMAIL_USER || 'lakaytax@gmail.com',
to: 'lakaytax@gmail.com',
subject,
text,
html
});

console.log('  Admin SSN notification email sent to lakaytax@gmail.com');
} catch (emailErr) {
console.error('  Failed to send SSN admin email:', emailErr);
}

return res.json({
ok: true,
message: logMatch
? 'Private information logged securely.'
: 'Private information received. Reference ID could not be auto-verified; our team will double-check it.'
});
} catch (err) {
console.error('private-info error:', err.message || err);
return res.status(500).json({ ok: false, error: 'Server error' });
}
});

/* ------------------------ BANK INFO (PRIVATE PAGE) ------------------------ */
app.post('/api/bank-info', async (req, res) => {
try {
const {referenceId,clientName,clientEmail,clientPhone,currentAddress,bankName,accountType,routingLast4,accountLast4,comments,addressConfirmed,fullAddress} = req.body || { } ;
// Required fields
if (!referenceId || !clientName || !clientEmail || !routingNumber || !accountNumber) {
return res.status(400).json({
ok: false,
error: 'Missing required fields'
});
}

// Step 1: USPS suggestion if not confirmed yet
if (currentAddress && process.env.USPS_USER_ID && addressConfirmed !== 'yes') {
const usps = await verifyAddressWithUSPS(currentAddress);
if (usps && usps.formatted) {
const given = currentAddress.trim().toLowerCase();
const suggested = usps.formatted.trim().toLowerCase();
if (given !== suggested) {
return res.json({
ok: false,
type: 'address_mismatch',
suggestedAddress: usps.formatted
});

}
}

// Step 3: send admin email
const mask = v => (v ? String(v).replace(/.(?=.{4})/g, '*') : '');
const maskedRouting = mask(routingNumber);
const maskedAccount = mask(accountNumber);

const transporter = createTransporter();
const adminTo =
process.env.BANK_ALERT_EMAIL ||
process.env.OWNER_EMAIL ||
process.env.EMAIL_USER ||
'lakaytax@gmail.com';

const text = `
New bank information submitted.

Ref: ${referenceId}
Name: ${clientName}
Email: ${clientEmail}
Phone: ${clientPhone || 'N/A'}
Address: ${currentAddress}

Bank: ${bankName}
Type: ${accountType}
Routing (masked): ${maskedRouting}
Account (masked): ${maskedAccount}

Comments:
${comments || '(none)'}
`.trim();

const html = `
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; line-height: 1.6;">
<h2 style="color:#1e63ff;margin-bottom:8px;">New Bank Information Submitted</h2>

<div style="background:#f8fafc;border-radius:8px;padding:14px 16px;margin-bottom:12px;">
<p style="margin:4px 0;"><strong>Ref:</strong> ${referenceId}</p>
<p style="margin:4px 0;"><strong>Name:</strong> ${clientName}</p>
<p style="margin:4px 0;"><strong>Email:</strong> ${
clientEmail
? `<a href="mailto:${clientEmail}" style="color:#1e63ff;">${clientEmail}</a>`
: 'N/A'
}</p>
<p style="margin:4px 0;"><strong>Phone:</strong> ${
clientPhone
? `<a href="tel:${clientPhone.replace(/[^0-9+]/g, '')}" style="color:#1e63ff;">${clientPhone}</a>`
: 'N/A'
}</p>
<p style="margin:4px 0;"><strong>Address:</strong> ${currentAddress}</p>
</div>

<div style="background:#ecfdf5;border-radius:8px;padding:14px 16px;margin-bottom:12px;">
<p style="margin:4px 0;"><strong>Bank:</strong> ${bankName}</p>
<p style="margin:4px 0;"><strong>Type:</strong> ${accountType}</p>
<p style="margin:4px 0;"><strong>Routing (masked):</strong> ${maskedRouting}</p>
<p style="margin:4px 0;"><strong>Account (masked):</strong> ${maskedAccount}</p>
</div>

${
comments
? `<p style="margin:4px 0;"><strong>Comments:</strong> ${comments}</p>`
: ''
}

<p style="margin-top:12px;font-size:12px;color:#64748b;">
Full routing and account numbers are <strong>not</strong> stored in email.
Last four digits are visible only in your private sheet.
</p>
</div>
`.trim();

await transporter.sendMail({
from: process.env.EMAIL_USER || 'lakaytax@gmail.com',
to: adminTo,
subject: `New Bank Info Submitted — Ref ${referenceId}`,
text,
html
});

console.log('  Bank info admin email sent to', adminTo);

return res.json({ ok: true, message: 'Bank info received securely.' });
} catch (e) {
console.error('bank-info error:', e);
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

/* -------- Helper: send status update email to customer -------------------- */
async function sendStatusEmail(ref, stage, note) {
try {
const client = findClientByRef(ref);
if (!client || !client.email) {
console.log(`  No email found for ref ${ref}, skipping status email.`);
return;
}

const transporter = createTransporter();
const safeStage = stage || 'Updated';
const safeName = client.name || 'Valued Customer';

const subject = `Your Tax Lakay filing status has been updated (${safeStage})`;

const text = `
Hi ${safeName},

This is a quick update from Tax Lakay about your tax return.

Your filing status has been updated to: ${safeStage}
Reference ID: ${ref}
${note ? `\nNote from preparer: ${note}\n` : ''}

You will also receive automatic email updates as your return moves through each stage.
You can check your current status online at:
https://www.taxlakay.com/filing-status
(Use your unique Reference ID: ${ref})

If you have any questions, you can reply to this email or call us at (317) 935-9067.

Warm regards,
Tax Lakay
  lakaytax@gmail.com
  (317) 935-9067
  https://www.taxlakay.com
`.trim();

const html = `
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; line-height: 1.6;">
<div style="text-align:center;margin-bottom:18px;">
<h2 style="color:#1e63ff;margin:0 0 4px;">Your Filing Status Has Been Updated</h2>
<p style="color:#64748b;margin:0;">Tax Lakay</p>
</div>

<p>Hi ${safeName},</p>
<p>This is a quick update from <strong>Tax Lakay</strong> about your tax return.</p>

<div style="background:#f0f9ff;border-radius:10px;padding:14px 16px;margin:12px 0;">
<p style="margin:0;font-size:14px;">
<strong>Status:</strong> <span style="color:#1e63ff;font-weight:700;">${safeStage}</span><br>
<strong>Reference ID:</strong> <span style="font-family:monospace;">${ref}</span>
${
note
? `<br><strong>Note from preparer:</strong> <span style="color:#111827;">${note}</span>`
: ''
}
</p>
</div>

<p style="font-size:14px;">
You will also receive <strong>automatic email updates</strong> as your return moves through each filing stage.
</p>

<p style="font-size:14px;">
At any time, you can check your current status online using your
unique Reference ID on our secure tracking page:
</p>

<p style="font-size:14px;">
  <a href="https://www.taxlakay.com/filing-status" style="color:#1e63ff;font-weight:bold;">
https://www.taxlakay.com/filing-status
</a><br>
<span style="font-size:13px;color:#4b5563;">
(Enter your Reference ID: <span style="font-family:monospace;">${ref}</span>)
</span>
</p>

<p style="font-size:14px;">
If you have any questions, you can reply to this email or call us at
<strong>(317) 935-9067</strong>.
</p>

<hr style="border:none;border-top:1px solid #e5e7eb;margin:18px 0;">

<p style="text-align:center;font-size:13px;color:#64748b;margin:0;">
  <a href="mailto:lakaytax@gmail.com" style="color:#1e63ff;">lakaytax@gmail.com</a> &nbsp;|&nbsp;
  <a href="tel:13179359067" style="color:#1e63ff;">(317) 935-9067</a> &nbsp;|&nbsp;
  <a href="https://www.taxlakay.com" style="color:#1e63ff;">www.taxlakay.com</a>
</p>
</div>
`.trim();

const mailOptions = {
from: process.env.EMAIL_USER || 'lakaytax@gmail.com',
to: client.email,
subject,
text,
html
};

await transporter.sendMail(mailOptions);
console.log(`  Status email sent to ${client.email} for ref ${ref}`);
} catch (e) {
console.error('sendStatusEmail failed:', e);
}
}

/* ------------------ Customer: check progress (GET) ------------------------ */
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
'Received',
'In Progress',
'Awaiting Documents',
'Completed',
'E-Filed',
'IRS Accepted',
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
return res.status(400).json({ ok: false, error: 'Missing ref or stage' });
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

sendStatusEmail(key, db[key].stage, db[key].note).catch(() => {});

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
app.post('/api/admin/progress', handleAdminUpdate);
app.post('/api/admin/update', handleAdminUpdate);

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
console.log(`  Tax Lakay Backend running on port ${PORT}`);
console.log(`  Health check: http://localhost:${PORT}/health`);
});
