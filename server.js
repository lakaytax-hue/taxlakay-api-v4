const express = require('express');
const cors = require('cors');
const multer = require('multer');
const nodemailer = require('nodemailer');
const json = require('./JSON.js'); // <- make sure the filename & case match

const app = express();

app.use(cors({
origin: ['https://www.taxlakay.com', 'https://taxlakay.com'],
credentials: true
}));
app.use(express.json());

const upload = multer({
storage: multer.memoryStorage(),
limits: { fileSize: 20 * 1024 * 1024, files: 10 }
});

function createTransporter() {
return nodemailer.createTransport({
service: 'gmail',
auth: {
user: process.env.EMAIL_USER || 'lakaytax@gmail.com',
pass: process.env.EMAIL_PASS
}
});
}

app.get('/', (req, res) => res.json({ ok: true, message: 'TaxLakay API v4 running' }));
app.get('/api/upload', (req, res) =>
res.json({ ok: true, message: '✅ Use POST /api/upload to send files.' })
);

app.post('/api/upload', upload.array('documents', 10), async (req, res) => {
try {
const ref = 'TL' + Math.floor(100000 + Math.random() * 900000);

const transporter = createTransporter();
const ownerEmail = process.env.OWNER_EMAIL || 'lakaytax@gmail.com';
const fromEmail = process.env.EMAIL_USER || 'lakaytax@gmail.com';
const clientName = req.body.clientName || 'Client';
const clientEmail = req.body.clientEmail;

await transporter.sendMail({
from: fromEmail,
to: ownerEmail,
subject: `New upload (${ref}) from ${clientName}`,
text: `Ref: ${ref}\nFiles: ${(req.files || []).length}\nEmail: ${clientEmail || ''}`
});

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

// If form includes <input type="hidden" name="stay" value="1">,
// the server returns 204 so the browser stays on your page.
return json.ok(res, payload, req.body.stay === '1');
} catch (err) {
console.error(err);
return json.error(res, err.message || 'Upload failed', 500);
}
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`TaxLakay API v4 listening on ${PORT}`));
