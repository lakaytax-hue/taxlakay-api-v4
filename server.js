const path = require('path');
const fs = require('fs');
const express = require('express');
const multer = require('multer');
const cors = require('cors');
const nodemailer = require('nodemailer');
const PDFDocument = require('pdfkit');

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
app.use(express.static(PUBLIC_DIR));

/* ------------------------------ CSV Log ------------------------------- */
const LOG_FILE = path.join(PUBLIC_DIR, 'uploads_log.csv');
function csvEscape(v){ if(v===undefined||v===null) return '""'; const s=String(v).replace(/"/g,'""'); return `"${s}"`; }
if (!fs.existsSync(LOG_FILE)) {
fs.writeFileSync(LOG_FILE,
'timestamp,ref,clientName,clientEmail,clientPhone,returnType,dependents,filesCount,fileNames\n'
);
}

/* ----------------------------- Multer conf ---------------------------- */
const upload = multer({
storage: multer.memoryStorage(),
limits: { fileSize: 20 * 1024 * 1024, files: 10 }
});

/* ------------------------- Email transporter -------------------------- */
const createTransporter = () => nodemailer.createTransport({
service: 'gmail',
auth: { user: process.env.EMAIL_USER || 'lakaytax@gmail.com', pass: process.env.EMAIL_PASS }
});

/* -------------------- Shared Header / Footer (Pro) -------------------- */
// Draws the blue header bar with site + logo
function drawPdfHeaderPro(doc) {
const logoPath = path.join(__dirname, 'public', 'logo.png');
// blue bar
doc.save();
doc.rect(0, 0, doc.page.width, 60).fill('#1e63ff');
// text
doc.fillColor('white').fontSize(20).text('TAX LAKAY', 50, 20);
doc.fontSize(10).text('www.taxlakay.com', doc.page.width - 200, 28, { width: 150, align: 'right' });
// logo
if (fs.existsSync(logoPath)) {
doc.image(logoPath, doc.page.width - 120, 12, { width: 60 });
}
doc.restore();
// Ensure content starts below header
if (doc.y < 80) doc.y = 80;
}

// Thin rule + tiny centered logo + contact + copyright
function drawPdfFooterPro(doc) {
const logoPath = path.join(__dirname, 'public', 'logo.png');
const marginX = 48;
const footerTop = doc.page.height - 80; // closer to bottom

doc.save();
doc.strokeColor('#e5e7eb').moveTo(marginX, footerTop).lineTo(doc.page.width - marginX, footerTop).stroke();

let y = footerTop + 8;

if (fs.existsSync(logoPath)) {
const imgW = 22;
const x = (doc.page.width - imgW) / 2;
doc.image(logoPath, x, y, { width: imgW });
y += 25;
}

doc.fillColor('#111827').fontSize(11).text('Tax Lakay', marginX, y, { align: 'center' });
y += 14;

doc.fillColor('#64748b').fontSize(10)
.text('(317) 935-9067 | www.taxlakay.com | lakaytax@gmail.com', marginX, y, { align: 'center' });
y += 14;

doc.fillColor('#9ca3af').fontSize(9)
.text(`© ${new Date().getFullYear()} Tax Lakay. All rights reserved.`, marginX, y, { align: 'center' });

doc.restore();
}

// Helper to enable repeating header+footer on every page
function applyPageChrome(doc) {
// draw for first page
drawPdfHeaderPro(doc);
drawPdfFooterPro(doc);
// and for every new page after that
doc.on('pageAdded', () => {
drawPdfHeaderPro(doc);
drawPdfFooterPro(doc);
});
}

/* -------------------------------- Health ------------------------------ */
app.get('/', (_, res) => res.json({ ok: true, msg: 'Tax Lakay Backend is running' }));
app.get('/health', (_, res) => res.json({ status: 'OK', service: 'Tax Lakay Backend' }));

/* ------------------------------ Upload API ---------------------------- */
app.post('/api/upload', upload.any(), async (req, res) => {
try {
if (!req.files?.length) return res.status(400).json({ ok: false, error: 'No files uploaded' });

const {
clientName, clientEmail, clientPhone,
returnType, dependents, clientMessage,
SEND_CLIENT_RECEIPT
} = req.body;

const sendClientReceipt = SEND_CLIENT_RECEIPT !== 'false';
const referenceNumber = `TL${Date.now().toString().slice(-6)}`;
const transporter = createTransporter();

// Admin email
const adminEmail = {
from: process.env.EMAIL_USER || 'lakaytax@gmail.com',
to: 'lakaytax@gmail.com',
subject: `📋 New Tax Document Upload - ${clientName || 'Customer'}`,
html: `
<h2 style="color:#1e63ff;">📋 New Document Upload</h2>
<p><b>Name:</b> ${clientName || 'N/A'}<br>
<b>Email:</b> ${clientEmail || 'N/A'}<br>
<b>Phone:</b> ${clientPhone || 'N/A'}<br>
<b>Return Type:</b> ${returnType || 'N/A'}<br>
<b>Dependents:</b> ${dependents || '0'}<br>
<b>Reference:</b> ${referenceNumber}</p>`,
attachments: req.files.map(f => ({ filename: f.originalname, content: f.buffer }))
};
await transporter.sendMail(adminEmail);

// Client email (simple receipt)
if (clientEmail) {
await transporter.sendMail({
from: process.env.EMAIL_USER || 'lakaytax@gmail.com',
to: clientEmail,
subject: "We've Received Your Documents — Tax Lakay",
text: `Hi ${clientName || 'Valued Customer'},\nYour reference number is ${referenceNumber}. Thank you!`,
html: `<p>Hi <b>${clientName || 'Valued Customer'}</b>,</p><p>We've received your documents. Your reference number is <b>${referenceNumber}</b>.</p>`
});
}

// CSV log
const files = req.files.map(f => f.originalname);
const row = [
new Date().toISOString(), referenceNumber,
clientName, clientEmail, clientPhone, returnType,
dependents, files.length, files.join('; ')
].map(csvEscape).join(',') + '\n';
fs.appendFile(LOG_FILE, row, () => {});

res.json({ ok: true, ref: referenceNumber });
} catch (err) {
console.error('Upload error:', err);
res.status(500).json({ ok: false, error: err.message });
}
});

/* -------------------- Estimator PDF -------------------- */
app.get('/api/estimator-pdf', (req, res) => {
const { estimate='—', withholding='0', kids='0', deps='0', ts=new Date().toLocaleString(), dl='0' } = req.query;

res.setHeader('Content-Type', 'application/pdf');
const disp = dl==='1' ? 'attachment' : 'inline';
res.setHeader('Content-Disposition', `${disp}; filename="TaxLakay-Estimate.pdf"`);

const doc = new PDFDocument({ size: 'LETTER', margin: 50 }); // 50 margin works with our header/footer
doc.pipe(res);

// repeat chrome on all pages
applyPageChrome(doc);

// Content
doc.moveDown(2)
.fillColor('#1e63ff').fontSize(18).text('Refund Estimate Summary')
.moveDown(0.6)
.fillColor('#111827').fontSize(12).text(`Date & Time: ${ts}`)
.moveDown();

doc.fontSize(14).fillColor('#111827').text(`Estimated Refund: ${estimate}`)
.moveDown(0.6).fontSize(12)
.text(`Federal withholding: ${withholding}`)
.text(`Qualifying children under 17: ${kids}`)
.text(`Other dependents: ${deps}`)
.moveDown()
.fontSize(10).fillColor('#6b7280')
.text('This is an estimate only based on simplified inputs. Your actual refund may differ after full review.');

doc.end();
});

/* -------------------- Upload Receipt PDF -------------------- */
app.get('/api/receipt-pdf', (req, res) => {
const { ref='TL-'+Date.now(), files='1', service='Tax Preparation — $150 Flat', emailOK='Sent', dateTime=new Date().toLocaleString() } = req.query;

res.setHeader('Content-Type', 'application/pdf');
res.setHeader('Content-Disposition', `attachment; filename="TaxLakay_Receipt_${String(ref).replace(/[^A-Za-z0-9_-]/g,'')}.pdf"`);

const doc = new PDFDocument({ size: 'LETTER', margin: 48 });
doc.pipe(res);

// repeat chrome on all pages
applyPageChrome(doc);

// Body
const rows = [
['Status', 'Completed'],
['Service', service],
['Files Received', files],
['Email Confirmation', emailOK],
['Reference ID', ref],
['Date & Time', dateTime]
];

doc.moveDown(1.5)
.fillColor('#1e63ff').fontSize(20).text('Tax Lakay — Upload Receipt');
doc.moveDown(0.8);

// success chip
const startY = doc.y;
doc.roundedRect(48, startY, 90, 24, 12).fill('#10b981');
doc.fillColor('#ffffff').fontSize(12).text('SUCCESS', 63, startY + 6);
doc.fillColor('#111827');
doc.y = startY + 36;

// note
const note = `Files uploaded successfully! Confirmation email: ${emailOK}.`;
doc.rect(48, doc.y, doc.page.width - 96, 40).fill('#f0f9ff');
doc.fillColor('#1e63ff').fontSize(12)
.text(note, 56, doc.y + 8, { width: doc.page.width - 112 });
doc.fillColor('#111827');
doc.moveDown(3);

// details table
let y = doc.y;
rows.forEach(([k, v]) => {
doc.moveTo(48, y).lineTo(doc.page.width - 48, y).strokeColor('#f1f5f9').stroke();
y += 10;
doc.fillColor('#64748b').fontSize(12).text(k, 48, y);
doc.fillColor('#111827').font('Helvetica-Bold').text(v, 300, y, { align: 'right' });
doc.font('Helvetica');
y += 22;
});
doc.moveTo(48, y).lineTo(doc.page.width - 48, y).strokeColor('#f1f5f9').stroke();

doc.end();
});

/* ----------------------------- Start Server ---------------------------- */
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
console.log(`🚀 Tax Lakay Backend running on port ${PORT}`);
console.log(`✅ Health check: http://localhost:${PORT}/health`);
});
