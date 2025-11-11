// ----------------------- Imports -----------------------
const path = require('path');
const fs = require('fs');
const express = require('express');
const multer = require('multer');
const cors = require('cors');
const nodemailer = require('nodemailer');
const PDFDocument = require('pdfkit');

const app = express();

// ----------------------- Config / Env ------------------
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
const OWNER_EMAIL = process.env.OWNER_EMAIL || 'lakaytax@gmail.com';
const EMAIL_USER = process.env.EMAIL_USER || 'lakaytax@gmail.com';
const EMAIL_PASS = process.env.EMAIL_PASS || '';
const SEND_CLIENT_RECEIPT = String(process.env.SEND_CLIENT_RECEIPT || 'true').toLowerCase() === 'true';

// CORS: allow multiple origins via ALLOW_ORIGIN="https://www.taxlakay.com,https://taxlakay.com,https://sites.google.com,http://localhost:3000"
const allowList = (process.env.ALLOW_ORIGIN || 'https://www.taxlakay.com,https://taxlakay.com')
.split(',').map(s => s.trim()).filter(Boolean);

app.use(cors({
origin(origin, cb) {
if (!origin) return cb(null, true); // same-origin / curl
const ok = allowList.some(a => origin.startsWith(a));
cb(ok ? null : new Error('Not allowed by CORS'), ok);
},
credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ----------------------- Public / Static ---------------
const PUBLIC_DIR = path.join(__dirname, 'public');
if (!fs.existsSync(PUBLIC_DIR)) fs.mkdirSync(PUBLIC_DIR, { recursive: true });
app.use(express.static(PUBLIC_DIR)); // serves /logo.png, /uploads_log.csv, /progress.json if needed

// ----------------------- CSV Log -----------------------
const LOG_FILE = path.join(PUBLIC_DIR, 'uploads_log.csv');
function csvEscape(v){ if(v==null) return '""'; return `"${String(v).replace(/"/g,'""')}"`; }
function ensureLogHeader(){
if (!fs.existsSync(LOG_FILE)) {
const header = [
'timestamp','ref','clientName','clientEmail','clientPhone',
'returnType','dependents','filesCount','fileNames'
].join(',') + '\n';
fs.writeFileSync(LOG_FILE, header);
}
}
ensureLogHeader();

// ----------------------- Multer ------------------------
const upload = multer({
storage: multer.memoryStorage(),
limits: { fileSize: 20 * 1024 * 1024, files: 10 } // 20MB, max 10 files
});

// ----------------------- Mailer ------------------------
function createTransporter(){
return nodemailer.createTransport({
service: 'gmail',
auth: { user: EMAIL_USER, pass: EMAIL_PASS }
});
}

// ----------------------- Health ------------------------
app.get('/', (req,res)=> res.json({ message:'Tax Lakay Backend is running!', timestamp: new Date().toISOString() }));
app.get('/health', (req,res)=> res.json({ status:'OK', service:'Tax Lakay Backend' }));

// ----------------------- Upload API --------------------
app.post('/api/upload', upload.any(), async (req, res) => {
try {
if (!req.files || req.files.length === 0) {
return res.status(400).json({ ok:false, error:'No files uploaded' });
}

const {
clientName, clientEmail, clientPhone,
returnType, dependents, clientMessage,
SEND_CLIENT_RECEIPT: sendClientFlag
} = req.body;

const sendClientReceipt = (sendClientFlag ?? SEND_CLIENT_RECEIPT) !== 'false';
const referenceNumber = `TL${Date.now().toString().slice(-6)}`;
const transporter = createTransporter();

// Admin email to you
const adminEmail = {
from: EMAIL_USER,
to: OWNER_EMAIL,
replyTo: clientEmail || undefined,
subject: `📋 New Tax Document Upload - ${clientName || 'Customer'}`,
html: `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
<h2 style="color:#1e63ff;">📋 New Document Upload Received</h2>
<div style="background:#f8fafc;padding:15px;border-radius:8px;margin:15px 0;">
<h3 style="margin-top:0;">Client Information:</h3>
<p><b>Name:</b> ${clientName || 'Not provided'}</p>
<p><b>Email:</b> ${clientEmail ? `<a href="mailto:${clientEmail}">${clientEmail}</a>` : 'Not provided'}</p>
<p><b>Phone:</b> ${clientPhone ? `<a href="tel:${clientPhone.replace(/[^0-9+]/g,'')}">${clientPhone}</a>` : 'Not provided'}</p>
<p><b>Return Type:</b> ${returnType || 'Not specified'}</p>
<p><b>Dependents:</b> ${dependents || '0'}</p>
<p><b>Files Uploaded:</b> ${req.files.length} files</p>
<p><b>Reference #:</b> ${referenceNumber}</p>
${clientMessage ? `<p><b>Client Message:</b> ${clientMessage}</p>` : ''}
</div>
<div style="background:#dcfce7;padding:10px;border-radius:5px;">
<p><b>Files received:</b></p>
<ul>
${req.files.map(f=>`<li>${f.originalname} (${(f.size/1024/1024).toFixed(2)} MB)</li>`).join('')}
</ul>
</div>
<p style="color:#64748b;font-size:12px;margin-top:20px;">Uploaded at: ${new Date().toLocaleString()}</p>
<hr style="border:none;border-top:1px solid #e5e7eb;margin:16px 0;">
<p style="font-size:13px;color:#475569;margin:0;">
📧 <a href="mailto:lakaytax@gmail.com">lakaytax@gmail.com</a> &nbsp;|&nbsp;
📞 <a href="tel:13179359067">(317) 935-9067</a> &nbsp;|&nbsp;
💻 <a href="https://www.taxlakay.com">www.taxlakay.com</a>
</p>
</div>
`.trim(),
attachments: req.files.map(f => ({ filename: f.originalname, content: f.buffer, contentType: f.mimetype }))
};

// Client email (optional with attachments)
let clientEmailSent = false;
if (clientEmail) {
const clientHTML = `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;line-height:1.6;">
<div style="text-align:center;margin-bottom:20px;">
<h2 style="color:#1e63ff;margin-bottom:5px;">We've Received Your Documents</h2>
<p style="color:#64748b;font-size:16px;">Tax Lakay</p>
</div>
<div style="background:#f0f9ff;padding:20px;border-radius:10px;margin:15px 0;">
<p><b>Hi ${clientName || 'Valued Customer'},</b></p>
<p>Thank you so much for choosing Tax Lakay! 🎉 We’ve received your documents and will start preparing your tax return shortly.</p>
<div style="background:#fff;padding:15px;border-radius:8px;border-left:4px solid #1e63ff;margin:15px 0;">
<p style="margin:0;font-weight:bold;">Your reference number is: <span style="color:#1e63ff;">${referenceNumber}</span></p>
</div>
<p>If we need anything else, we’ll reach out right away.</p>
</div>
<div style="text-align:center;margin-top:25px;padding-top:20px;border-top:1px solid #e5e7eb;">
<p style="margin:5px 0;color:#475569;"><b>Warm regards,</b><br>The Tax Lakay Team</p>
<p style="margin:8px 0;color:#64748b;">
📧 <a href="mailto:lakaytax@gmail.com" style="color:#1e63ff;">lakaytax@gmail.com</a> &nbsp;
📞 <a href="tel:3179359067" style="color:#1e63ff;">(317) 935-9067</a><br>
💻 <a href="https://www.taxlakay.com" style="color:#1e63ff;">www.taxlakay.com</a>
</p>
</div>
</div>
`.trim();

const clientOptions = {
from: EMAIL_USER,
to: clientEmail,
subject: sendClientReceipt ? "We've Received Your Documents — (Files Attached)" : "We've Received Your Documents — Tax Lakay",
html: clientHTML,
attachments: sendClientReceipt
? req.files.map(f => ({ filename: f.originalname, content: f.buffer, contentType: f.mimetype }))
: []
};

try { await createTransporter().sendMail(clientOptions); clientEmailSent = true; } catch(e){ console.error('Client email error:', e); }
}

await createTransporter().sendMail(adminEmail);

// CSV append
const row = [
new Date().toISOString(),
referenceNumber,
req.body.clientName,
req.body.clientEmail,
req.body.clientPhone || '',
req.body.returnType || '',
req.body.dependents || '0',
req.files.length,
(req.files || []).map(f=>f.originalname).join('; ')
].map(csvEscape).join(',') + '\n';
fs.appendFile(LOG_FILE, row, (err)=>{ if (err) console.error('CSV append error:', err); });

res.json({ ok:true, message:'Files uploaded successfully! Confirmation email sent.', filesReceived: req.files.length, clientEmailSent, ref: referenceNumber });
} catch (err) {
console.error('Upload error:', err);
res.status(500).json({ ok:false, error:'Upload failed: ' + err.message });
}
});

// ----------------------- Estimator PDF -----------------
app.get('/api/estimator-pdf', (req,res)=>{
const {
estimate='—', withholding='0', kids='0', deps='0',
ts=new Date().toLocaleString(), dl='0'
} = req.query;

res.setHeader('Content-Type', 'application/pdf');
res.setHeader('Content-Disposition', (dl==='1'?'attachment':'inline') + '; filename="TaxLakay-Estimate.pdf"');

const doc = new PDFDocument({ size:'LETTER', margin:50 });
doc.pipe(res);

// header bar
doc.rect(0,0,doc.page.width,60).fill('#1e63ff');
doc.fillColor('#fff').fontSize(20).text('TAX LAKAY', 50, 20);
doc.fillColor('#fff').fontSize(10).text('www.taxlakay.com', 420, 28, { align:'right' });

const logoPath = path.join(PUBLIC_DIR, 'logo.png');
if (fs.existsSync(logoPath)) doc.image(logoPath, doc.page.width - 120, 15, { width:60 });

doc.moveDown(3);
doc.fillColor('#1e63ff').fontSize(18).text('Refund Estimate Summary');
doc.moveDown(0.5);
doc.fillColor('#111827').fontSize(12).text(`Date & Time: ${ts}`);
doc.moveDown();
doc.fontSize(14).fillColor('#111827').text(`Estimated Refund: ${estimate}`);
doc.moveDown(0.5);
doc.fontSize(12)
.text(`Federal withholding: ${withholding}`)
.text(`Qualifying children under 17: ${kids}`)
.text(`Other dependents: ${deps}`);
doc.moveDown();
doc.fontSize(10).fillColor('#6b7280').text('This is an estimate only based on simplified inputs. Your actual refund may differ after full review.');
doc.moveDown().fillColor('#111827').text('Contact: lakaytax@gmail.com');
doc.end();
});

// ----------------------- Upload Receipt PDF ------------
app.get('/api/receipt-pdf', (req,res)=>{
try {
const {
ref = 'TL-' + Date.now(),
files = '1',
service = 'Tax Preparation — $150 Flat',
emailOK = 'Sent',
dateTime = new Date().toLocaleString('en-US', { year:'numeric', month:'long', day:'numeric', hour:'2-digit', minute:'2-digit' })
} = req.query;

res.setHeader('Content-Type', 'application/pdf');
res.setHeader('Content-Disposition', `attachment; filename="TaxLakay_Receipt_${String(ref).replace(/[^A-Za-z0-9_-]/g,'')}.pdf"`);

const doc = new PDFDocument({ size:'LETTER', margin:48 });
doc.pipe(res);

const logoPath = path.join(PUBLIC_DIR, 'logo.png');
if (fs.existsSync(logoPath)) doc.image(logoPath, 48, 36, { width:80 });
doc.fontSize(20).fillColor('#1e63ff').text('Tax Lakay — Upload Receipt', 140, 42);
doc.moveDown(1.2);

// success badge
doc.roundedRect(48, 90, 90, 24, 12).fill('#10b981');
doc.fillColor('#ffffff').fontSize(12).text('SUCCESS', 63, 96);
doc.fillColor('#111827');

// note box
const note = `Files uploaded successfully! Confirmation email: ${emailOK}.`;
doc.rect(48, 130, doc.page.width - 96, 40).fill('#f0f9ff');
doc.fillColor('#1e63ff').fontSize(12).text(note, 56, 138, { width: doc.page.width - 112 });
doc.fillColor('#111827');

// details
const rows = [
['Status', 'Completed'],
['Service', String(service)],
['Files Received', String(files)],
['Email Confirmation', String(emailOK)],
['Reference ID', String(ref)],
['Date & Time', String(dateTime)]
];
let y = 190;
rows.forEach(([k,v])=>{
doc.moveTo(48,y).lineTo(doc.page.width-48,y).strokeColor('#f1f5f9').stroke();
y += 10;
doc.fillColor('#64748b').fontSize(12).text(k,48,y);
doc.fillColor('#111827').font('Helvetica-Bold').text(v,300,y,{ align:'right' });
doc.font('Helvetica'); y += 22;
});
doc.moveTo(48,y).lineTo(doc.page.width-48,y).strokeColor('#f1f5f9').stroke();

// footer
doc.moveDown(2);
doc.fillColor('#475569').fontSize(10)
.text('📞 (317) 935-9067 | 🌐 www.taxlakay.com | 📧 lakaytax@gmail.com', { align:'center' });
doc.fillColor('#94a3b8')
.text(`© ${new Date().getFullYear()} Tax Lakay. All rights reserved.`, { align:'center' });

doc.end();
} catch(e){
console.error('PDF error:', e);
res.status(500).json({ error: 'Failed to generate PDF' });
}
});

// ===================== Filing Progress Storage ======================
const PROGRESS_FILE = path.join(PUBLIC_DIR, 'progress.json');

function readProgress(){
try {
if (!fs.existsSync(PROGRESS_FILE)) return {};
const raw = fs.readFileSync(PROGRESS_FILE, 'utf8');
return JSON.parse(raw || '{}');
} catch {
return {};
}
}

function writeProgress(db){
try {
fs.writeFileSync(PROGRESS_FILE, JSON.stringify(db, null, 2));
return true;
} catch {
return false;
}
}

// Customer-facing: GET progress
app.get('/api/progress', (req,res)=>{
const ref = (req.query.ref || '').trim();
if (!ref) return res.json({ status: null });
const db = readProgress();
const key = String(ref).trim().toUpperCase();
const rec = db[key] || null;
res.json(rec ? { status: rec.stage, note: rec.note || '', updatedAt: rec.updatedAt } : { status: null });
});

// Admin: verify token (optional convenience)
app.get('/api/admin/verify', (req,res)=>{
const t = (req.query.token || '').trim();
if (!ADMIN_TOKEN) return res.status(500).json({ ok:false, error:'Missing ADMIN_TOKEN on server' });
res.json({ ok: t && t === ADMIN_TOKEN });
});

// Admin: update progress (expects header x-admin-token)
app.post('/api/admin/progress', (req,res)=>{
try {
if (!ADMIN_TOKEN) return res.status(500).json({ ok:false, error:'Missing ADMIN_TOKEN on server' });

const token = (req.headers['x-admin-token'] || '').trim();
if (!token || token !== ADMIN_TOKEN) {
return res.status(401).json({ ok:false, error:'Unauthorized' });
}

const ref = (req.body.ref || '').trim();
const stage = (req.body.stage || '').trim();
const note = (req.body.note || '').trim();

if (!ref || !stage) return res.status(400).json({ ok:false, error:'ref and stage are required' });

const key = ref.toUpperCase();
const db = readProgress();
db[key] = {
stage,
note: note || '',
updatedAt: new Date().toISOString()
};
if (!writeProgress(db)) return res.status(500).json({ ok:false, error:'Failed to persist' });

res.json({ ok:true, ref, key, stage: db[key].stage, updatedAt: db[key].updatedAt });
} catch (e) {
console.error('admin/progress error:', e);
res.status(500).json({ ok:false, error:'server error' });
}
});

// ----------------------- Start server -----------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
console.log(`🚀 Tax Lakay Backend running on port ${PORT}`);
console.log(`✅ Health check: http://localhost:${PORT}/health`);
});
