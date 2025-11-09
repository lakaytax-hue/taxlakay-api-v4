const path = require('path');
const fs = require('fs');
const express = require('express');
const multer = require('multer');
const cors = require('cors');
const nodemailer = require('nodemailer');
const PDFDocument = require('pdfkit');

const app = express();

/* ==================== Middleware ==================== */
app.use(cors({
origin: ['https://www.taxlakay.com', 'https://taxlakay.com', 'http://localhost:3000'],
credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true })); // parse form fields

/* ==================== Static /public ==================== */
const PUBLIC_DIR = path.join(__dirname, 'public');
if (!fs.existsSync(PUBLIC_DIR)) fs.mkdirSync(PUBLIC_DIR, { recursive: true });
// serve logo.png and uploads_log.csv (download protected via /api/logs, but file itself is static)
app.use(express.static(PUBLIC_DIR));

/* ==================== CSV logging ==================== */
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

/* ==================== Multer (uploads) ==================== */
// Accept any file field name (documents, files, file, etc.)
const upload = multer({
storage: multer.memoryStorage(),
limits: { fileSize: 20 * 1024 * 1024, files: 10 } // 20MB each, up to 10
});

/* ==================== Mailer ==================== */
const createTransporter = () => {
return nodemailer.createTransport({
service: 'gmail',
auth: {
user: process.env.EMAIL_USER || 'lakaytax@gmail.com',
pass: process.env.EMAIL_PASS // Use a Gmail App Password
}
});
};

/* ==================== Helpers ==================== */
function formatET(d = new Date()) {
try {
return d.toLocaleString('en-US', {
timeZone: 'America/New_York',
year: 'numeric', month: 'long', day: 'numeric',
hour: '2-digit', minute: '2-digit'
}).replace(',', ' at');
} catch {
return new Date().toLocaleString();
}
}

// TL-YYYYMMDD-HHMMSS-XXXXX
function genRef() {
const d = new Date();
const pad = n => String(n).padStart(2, '0');
const date = d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate());
const time = pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
let rand = Math.floor(Math.random() * 0xFFFFF).toString(16).toUpperCase().padStart(5, '0');
try {
const { webcrypto } = require('crypto');
const u = new Uint32Array(1);
webcrypto.getRandomValues(u);
rand = u[0].toString(16).slice(-5).toUpperCase().padStart(5, '0');
} catch {}
return `TL-${date}-${time}-${rand}`;
}

/* ==================== Basic routes ==================== */
app.get('/', (req, res) => {
res.json({ message: 'Tax Lakay Backend is running!', timestamp: new Date().toISOString() });
});
app.get('/health', (req, res) => {
res.json({ status: 'OK', service: 'Tax Lakay Backend' });
});

/* ==================== Upload endpoint ==================== */
app.post('/api/upload', upload.any(), async (req, res) => {
try {
const files = (req.files || []);
console.log('📨 Upload request received — files:', files.length);
if (files.length === 0) {
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
const referenceNumber = genRef();
const preparedAtET = formatET();

const transporter = createTransporter();

/* ----- Admin email ----- */
const adminEmail = {
from: process.env.EMAIL_USER || 'lakaytax@gmail.com',
to: 'lakaytax@gmail.com',
replyTo: clientEmail || undefined,
subject: `📋 New Tax Document Upload — ${clientName || 'Customer'} (${referenceNumber})`,
html: `
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
<h2 style="color: #1e63ff;">📋 New Document Upload Received</h2>
<div style="background: #f8fafc; padding: 15px; border-radius: 8px; margin: 15px 0;">
<h3 style="margin-top: 0;">Client Information</h3>
<p><strong>Name:</strong> ${clientName || 'Not provided'}</p>
<p><strong>Email:</strong> ${clientEmail ? `<a href="mailto:${clientEmail}">${clientEmail}</a>` : 'Not provided'}</p>
<p><strong>Phone:</strong> ${clientPhone ? `<a href="tel:${clientPhone.replace(/[^0-9+]/g,'')}">${clientPhone}</a>` : 'Not provided'}</p>
<p><strong>Return Type:</strong> ${returnType || 'Not specified'}</p>
<p><strong>Dependents:</strong> ${dependents || '0'}</p>
<p><strong>Files Uploaded:</strong> ${files.length} file(s)</p>
<p><strong>Reference #:</strong> ${referenceNumber}</p>
<p><strong>Uploaded at:</strong> ${preparedAtET}</p>
${clientMessage ? `<p><strong>Client Message:</strong> ${clientMessage}</p>` : ''}
</div>
<div style="background: #dcfce7; padding: 10px; border-radius: 5px;">
<p><strong>Files received:</strong></p>
<ul>${files.map(f => `<li>${f.originalname} (${(f.size/1024/1024).toFixed(2)} MB)</li>`).join('')}</ul>
</div>
<hr style="border:none;border-top:1px solid #e5e7eb;margin:16px 0;">
<p style="font-size:13px;color:#475569;margin:0;">
📧 <a href="mailto:lakaytax@gmail.com">lakaytax@gmail.com</a> &nbsp;|&nbsp;
📞 <a href="tel:13179359067">(317) 935-9067</a> &nbsp;|&nbsp;
💻 <a href="https://www.taxlakay.com">www.taxlakay.com</a>
</p>
</div>`.trim(),
attachments: files.map(file => ({
filename: file.originalname,
content: file.buffer,
contentType: file.mimetype
}))
};

/* ----- Client email (optional attachments) ----- */
let clientEmailSent = false;
if (clientEmail) {
const clientSubjectBase = "We've Received Your Documents — Tax Lakay";
const clientEmailOptions = {
from: process.env.EMAIL_USER || 'lakaytax@gmail.com',
to: clientEmail,
subject: sendClientReceipt ? `${clientSubjectBase} (Files Attached)` : clientSubjectBase,
text: `
Hi ${clientName || 'Valued Customer'},

Thank you for choosing Tax Lakay! We’ve received your documents.
Your reference number is ${referenceNumber}.
Received: ${preparedAtET}

We’ll begin preparing your tax return shortly. If we need anything else, we’ll contact you.

— Tax Lakay
📧 lakaytax@gmail.com
📞 (317) 935-9067
💻 https://www.taxlakay.com
`.trim(),
html: `
<div style="font-family: Arial, sans-serif; max-width:600px; margin:0 auto; line-height:1.6;">
<div style="text-align:center; margin-bottom: 20px;">
<h2 style="color:#1e63ff; margin-bottom:5px;">We've Received Your Documents</h2>
<p style="color:#64748b; font-size:16px;">Tax Lakay</p>
</div>
<div style="background:#f0f9ff; padding:20px; border-radius:10px; margin:15px 0;">
<p><strong>Hi ${clientName || 'Valued Customer'},</strong></p>
<p>Thanks for choosing Tax Lakay! We’ve received your documents and started your file.</p>
<p style="margin:0 0 8px 0;"><strong>Reference #:</strong> <span style="color:#1e63ff;">${referenceNumber}</span></p>
<p style="margin:0;"><strong>Received:</strong> ${preparedAtET}</p>
</div>
<div style="text-align:center; margin-top:20px; padding-top: 16px; border-top:1px solid #e5e7eb;">
<p style="margin:8px 0; color:#64748b;">
📧 <a href="mailto:lakaytax@gmail.com" style="color:#1e63ff;">lakaytax@gmail.com</a> &nbsp;
📞 <a href="tel:3179359067" style="color:#1e63ff;">(317) 935-9067</a> &nbsp;
💻 <a href="https://www.taxlakay.com" style="color:#1e63ff;">www.taxlakay.com</a>
</p>
</div>
</div>`.trim()
};

if (sendClientReceipt) {
clientEmailOptions.attachments = files.map(file => ({
filename: file.originalname,
content: file.buffer,
contentType: file.mimetype
}));
}

try {
await transporter.sendMail(clientEmailOptions);
clientEmailSent = true;
console.log('✅ Client confirmation email sent →', clientEmail, 'attachments:', !!sendClientReceipt);
} catch (emailError) {
console.error('❌ Failed to send client email:', emailError);
}
}

// Send admin email
await transporter.sendMail(adminEmail);
console.log('✅ Admin notification email sent');

/* ----- CSV Log append ----- */
try {
const row = [
new Date().toISOString(),
referenceNumber,
clientName || '',
clientEmail || '',
clientPhone || '',
returnType || '',
dependents || '0',
files.length,
files.map(f => f.originalname).join('; ')
].map(csvEscape).join(',') + '\n';

fs.appendFile(LOG_FILE, row, (err) => {
if (err) console.error('CSV append error:', err);
});
} catch (e) {
console.error('CSV logging failed:', e);
}

/* ----- Response to front-end (for receipt embed) ----- */
res.json({
ok: true,
message: 'Files uploaded successfully!',
ref: referenceNumber,
files: String(files.length),
status: 'Completed',
date: preparedAtET,
clientEmailSent
});

} catch (error) {
console.error('❌ Upload error:', error);
res.status(500).json({ ok: false, error: 'Upload failed: ' + error.message });
}
});

/* ==================== Refund Estimator PDF ==================== */
app.get('/api/estimator-pdf', (req, res) => {
const {
estimate = '—',
withholding = '0',
kids = '0',
deps = '0',
ts = formatET(),
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

// Logo from /public/logo.png
const logoPath = path.join(PUBLIC_DIR, 'logo.png');
if (fs.existsSync(logoPath)) {
doc.image(logoPath, doc.page.width - 120, 15, { width: 60 });
}
doc.moveDown(3);

// Title + summary
doc.fillColor('#1e63ff').fontSize(18).text('Refund Estimate Summary', { align: 'left' });
doc.moveDown(0.5);
doc.fillColor('#111827').fontSize(12).text(`Date & Time: ${ts}`);
doc.moveDown();

doc.fontSize(14).fillColor('#111827').text(`Estimated Refund: ${estimate}`, { continued: false });
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

/* ==================== Secure Logs API ==================== */
// GET /api/logs?token=...&format=csv|json&from=YYYY-MM-DD&to=YYYY-MM-DD
function requireLogsToken(req, res, next) {
const token = req.query.token || req.get('x-logs-token');
if (!token || token !== (process.env.LOGS_TOKEN || '')) {
return res.status(401).json({ ok: false, error: 'Unauthorized: invalid or missing token' });
}
return next();
}
function parseISODate(s) {
if (!s) return null;
const d = new Date(s + 'T00:00:00Z');
return isNaN(d.getTime()) ? null : d;
}

app.get('/api/logs', requireLogsToken, async (req, res) => {
try {
const format = (req.query.format || 'csv').toLowerCase();
const from = parseISODate(req.query.from);
const to = parseISODate(req.query.to);

if (!fs.existsSync(LOG_FILE)) {
return res.status(404).json({ ok: false, error: 'Log file not found' });
}

if (format === 'csv') {
if (!from && !to) {
res.setHeader('Content-Type', 'text/csv; charset=utf-8');
res.setHeader('Content-Disposition', 'attachment; filename="uploads_log.csv"');
return fs.createReadStream(LOG_FILE).pipe(res);
}
const raw = fs.readFileSync(LOG_FILE, 'utf8').split('\n');
if (raw.length === 0) return res.status(204).end();
const header = raw[0];
const rows = raw.slice(1).filter(Boolean);
const filtered = rows.filter(line => {
const ts = line.split(',')[0]?.replace(/^"|"$/g, '');
const dt = new Date(ts);
if (isNaN(dt.getTime())) return false;
if (from && dt < from) return false;
if (to) {
const toEnd = new Date(to); toEnd.setUTCDate(toEnd.getUTCDate() + 1);
if (dt >= toEnd) return false;
}
return true;
});
res.setHeader('Content-Type', 'text/csv; charset=utf-8');
res.setHeader('Content-Disposition', 'attachment; filename="uploads_log_filtered.csv"');
return res.end([header, ...filtered].join('\n'));
}

if (format === 'json') {
const raw = fs.readFileSync(LOG_FILE, 'utf8').split('\n').filter(Boolean);
if (raw.length === 0) return res.json({ ok: true, records: [] });

const headers = raw[0].split(',').map(h => h.replace(/^"|"$/g, ''));
const lines = raw.slice(1);
const records = lines.map(line => {
const cols = [];
let cur = '', inQ = false;
for (let i = 0; i < line.length; i++) {
const ch = line[i];
if (ch === '"') {
if (inQ && line[i + 1] === '"') { cur += '"'; i++; } else { inQ = !inQ; }
} else if (ch === ',' && !inQ) {
cols.push(cur); cur = '';
} else {
cur += ch;
}
}
cols.push(cur);
const obj = {};
headers.forEach((h, idx) => obj[h] = (cols[idx] || '').replace(/^"|"$/g, ''));
return obj;
}).filter(rec => {
if (!from && !to) return true;
const dt = new Date(rec.timestamp);
if (isNaN(dt.getTime())) return false;
if (from && dt < from) return false;
if (to) {
const toEnd = new Date(to); toEnd.setUTCDate(toEnd.getUTCDate() + 1);
if (dt >= toEnd) return false;
}
return true;
});

return res.json({ ok: true, records });
}

return res.status(400).json({ ok: false, error: 'Invalid format. Use format=csv or format=json' });
} catch (err) {
console.error('Logs error:', err);
return res.status(500).json({ ok: false, error: 'Failed to read logs' });
}
});

/* ==================== Admin Logs UI ==================== */
app.get('/admin/logs', (req, res) => {
res.type('html').send(`
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Tax Lakay — Logs Downloader</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
body { font-family: Inter, Arial, sans-serif; background:#f8fafc; color:#0f172a; margin:0; }
.wrap { max-width:720px; margin:40px auto; background:#fff; border:1px solid #e5e7eb; border-radius:14px; padding:18px; box-shadow:0 2px 10px rgba(0,0,0,.04); }
h1 { margin:0 0 10px; color:#1e63ff; font-size:22px; }
.row { display:grid; grid-template-columns:1fr 1fr; gap:10px; }
label { display:block; font-size:13px; color:#334155; margin:8px 0 4px; }
input, select { width:100%; padding:10px; border:1px solid #e5e7eb; border-radius:10px; font-size:14px; }
.full { grid-column:1 / -1; }
.actions { display:flex; gap:10px; margin-top:14px; flex-wrap:wrap; }
button { background:#1e63ff; color:#fff; font-weight:700; padding:11px 18px; border:none; border-radius:10px; cursor:pointer; min-width:180px; box-shadow:0 1px 4px rgba(0,0,0,.12); }
.muted { color:#64748b; font-size:12px; margin-top:8px; }
.err { color:#b91c1c; font-size:13px; margin:8px 0 0; display:none; }
.ok { color:#065f46; font-size:13px; margin:8px 0 0; display:none; }
.footer { text-align:center; margin-top:16px; color:#94a3b8; font-size:12px; }
.brand { display:flex; align-items:center; gap:10px; margin-bottom:10px; }
.brand img { height:26px; width:auto; }
.checkbox { display:flex; align-items:center; gap:8px; margin-top:8px; }
</style>
</head>
<body>
<div class="wrap">
<div class="brand">
<img src="/logo.png" alt="Tax Lakay" onerror="this.style.display='none'">
<h1>Tax Lakay — Logs Downloader</h1>
</div>
<p class="muted">Download <b>uploads_log.csv</b> securely. Your token is never placed in the URL; it is sent via an HTTP header only.</p>

<form id="logsForm">
<div class="row">
<div class="full">
<label for="token">Security Token</label>
<input id="token" name="token" type="password" placeholder="Enter your LOGS_TOKEN" required>
<div class="checkbox">
<input id="remember" type="checkbox">
<label for="remember" style="margin:0;">Remember token on this device</label>
</div>
</div>
<div>
<label for="from">From (YYYY-MM-DD)</label>
<input id="from" name="from" type="date">
</div>
<div>
<label for="to">To (YYYY-MM-DD)</label>
<input id="to" name="to" type="date">
</div>
<div>
<label for="format">Format</label>
<select id="format" name="format">
<option value="csv">CSV</option>
<option value="json">JSON</option>
</select>
</div>
<div>
<label for="filename">Save as filename</label>
<input id="filename" name="filename" type="text" placeholder="uploads_log.csv">
</div>
</div>

<div class="actions">
<button id="downloadBtn" type="submit">⬇️ Download Logs</button>
<button id="clearBtn" type="button" style="background:#fff;color:#0f172a;border:1px solid #e5e7eb;">Clear</button>
</div>

<div id="msgOk" class="ok">Download started…</div>
<div id="msgErr" class="err">Error downloading logs. Check your token and try again.</div>
<p class="muted">Tip: Keep your token secret. If this page is public, consider adding additional auth/IP allow-listing.</p>
</form>

<div class="footer">© <span id="year"></span> Tax Lakay</div>
</div>

<script>
(function(){
const $ = (id) => document.getElementById(id);
const tokenInput = $('token');
const remember = $('remember');
const from = $('from');
const to = $('to');
const format = $('format');
const filename = $('filename');
const msgOk = $('msgOk');
const msgErr = $('msgErr');
const year = $('year');

year.textContent = new Date().getFullYear();

try {
const saved = localStorage.getItem('tl_logs_token');
if (saved) { tokenInput.value = saved; remember.checked = true; }
} catch(e){}

function updateFilename(){
if (!filename.value) {
filename.value = (format.value === 'json') ? 'uploads_log.json' : 'uploads_log.csv';
} else if (format.value === 'json' && !filename.value.endsWith('.json')) {
filename.value = filename.value.replace(/\\.[^/.]+$/, '') + '.json';
} else if (format.value === 'csv' && !filename.value.endsWith('.csv')) {
filename.value = filename.value.replace(/\\.[^/.]+$/, '') + '.csv';
}
}
updateFilename();
format.addEventListener('change', updateFilename);

$('clearBtn').addEventListener('click', () => {
from.value = ''; to.value=''; msgOk.style.display='none'; msgErr.style.display='none';
});

$('logsForm').addEventListener('submit', async (e) => {
e.preventDefault();
msgOk.style.display='none'; msgErr.style.display='none';

const token = tokenInput.value.trim();
if (!token) { msgErr.textContent='Missing token'; msgErr.style.display='block'; return; }

try {
if (remember.checked) localStorage.setItem('tl_logs_token', token);
else localStorage.removeItem('tl_logs_token');
} catch(e){}

const params = new URLSearchParams();
if (from.value) params.append('from', from.value);
if (to.value) params.append('to', to.value);
if (format.value === 'json') params.append('format', 'json');

const url = '/api/logs' + (params.toString() ? '?' + params.toString() : '');

try {
const resp = await fetch(url, { headers: { 'x-logs-token': token } });
if (!resp.ok) throw new Error('HTTP ' + resp.status);

const blob = await resp.blob();
const a = document.createElement('a');
const objectUrl = URL.createObjectURL(blob);
a.href = objectUrl;
a.download = (filename.value || (format.value === 'json' ? 'uploads_log.json' : 'uploads_log.csv')).trim();
document.body.appendChild(a);
a.click();
a.remove();
URL.revokeObjectURL(objectUrl);
msgOk.style.display='block';
} catch (err) {
console.error(err);
msgErr.textContent = 'Error downloading logs. Check your token and date range.';
msgErr.style.display='block';
}
});
})();
</script>
</body>
</html>
`);
});

/* ==================== Start ==================== */
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
console.log(`🚀 Tax Lakay Backend running on port ${PORT}`);
console.log(`✅ Health check: http://localhost:${PORT}/health`);
});
