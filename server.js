const express = require('express');
const multer = require('multer');
const cors = require('cors');
const nodemailer = require('nodemailer');

const app = express();

// Middleware
app.use(cors({
origin: ['https://www.taxlakay.com', 'https://taxlakay.com', 'http://localhost:3000'],
credentials: true
}));
app.use(express.json());

// Multer configuration
const upload = multer({
storage: multer.memoryStorage(),
limits: {
fileSize: 20 * 1024 * 1024, // 20MB
files: 10
}
});

// Email transporter setup
const createTransporter = () => {
return nodemailer.createTransport({
service: 'gmail',
auth: {
user: process.env.EMAIL_USER || 'lakaytax@gmail.com',
pass: process.env.EMAIL_PASS
}
});
};

// Test route
app.get('/', (req, res) => {
res.json({
message: 'Tax Lakay Backend is running!',
timestamp: new Date().toISOString()
});
});

// Health check
app.get('/health', (req, res) => {
res.json({ status: 'OK', service: 'Tax Lakay Backend' });
});

// Upload endpoint with email functionality
app.post('/api/upload', upload.array('documents', 10), async (req, res) => {
try {
console.log('📨 Upload request received');
console.log('Files:', req.files ? req.files.length : 0);
console.log('Body:', req.body);

if (!req.files || req.files.length === 0) {
return res.status(400).json({
ok: false,
error: 'No files uploaded'
});
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

// Create email transporter
const transporter = createTransporter();

// 1. Email to YOU (lakaytax@gmail.com) - Always send
const adminEmail = {
from: process.env.EMAIL_USER || 'lakaytax@gmail.com',
to: 'lakaytax@gmail.com',
subject: `📋 New Tax Document Upload - ${clientName || 'Customer'}`,
html: `
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
<h2 style="color: #1e63ff;">📋 New Document Upload Received</h2>

<div style="background: #f8fafc; padding: 15px; border-radius: 8px; margin: 15px 0;">
<h3 style="margin-top: 0;">Client Information:</h3>
<p><strong>Name:</strong> ${clientName || 'Not provided'}</p>
<p><strong>Email:</strong> ${clientEmail || 'Not provided'}</p>
<p><strong>Phone:</strong> ${clientPhone || 'Not provided'}</p>
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
</div>
`,
attachments: req.files.map(file => ({
filename: file.originalname,
content: file.buffer,
contentType: file.mimetype
}))
};

// 2. Email to CLIENT - ALWAYS SEND (with or without file attachments)
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
📧 lakaytax@gmail.com 📞 (317) 935-9067
💻 www.taxlakay.com
`.trim();

const clientEmailHTML = `
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; line-height: 1.6;">
<div style="text-align: center; margin-bottom: 20px;">
<h2 style="color: #1e63ff; margin-bottom: 5px;">We've Received Your Documents</h2>
<p style="color: #64748b; font-size: 16px;">Tax Lakay</p>
</div>

<div style="background: #f0f9ff; padding: 20px; border-radius: 10px; margin: 15px 0;">
<p style="margin: 0 0 15px 0;"><strong>Hi ${clientName || 'Valued Customer'},</strong></p>

<p style="margin: 0 0 15px 0;">Thank you so much for choosing Tax Lakay! 🎉</p>

<p style="margin: 0 0 15px 0;">We've received your documents and will start preparing your tax return within the next hour.<br>
If we need any additional information, we'll reach out right away.</p>

<div style="background: #ffffff; padding: 15px; border-radius: 8px; border-left: 4px solid #1e63ff; margin: 15px 0;">
<p style="margin: 0; font-weight: bold;">Your reference number is: <span style="color: #1e63ff;">${referenceNumber}</span></p>
</div>

<p style="margin: 15px 0;">We appreciate your trust and look forward to helping you get the best refund possible!</p>
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
`;

const clientEmailOptions = {
from: process.env.EMAIL_USER || 'lakaytax@gmail.com',
to: clientEmail,
subject: clientSubject,
text: clientEmailText,
html: clientEmailHTML
};

// Add file attachments ONLY if customer selected the receipt option
if (sendClientReceipt) {
clientEmailOptions.attachments = req.files.map(file => ({
filename: file.originalname,
content: file.buffer,
contentType: file.mimetype
}));

// Update subject to indicate files are attached
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

// Send admin email (to you)
await transporter.sendMail(adminEmail);
console.log('✅ Admin notification email sent to lakaytax@gmail.com');

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
res.status(500).json({
ok: false,
error: 'Upload failed: ' + error.message
});
}
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
console.log(`🚀 Tax Lakay Backend running on port ${PORT}`);
console.log(`✅ Health check: http://localhost:${PORT}/health`);
})
