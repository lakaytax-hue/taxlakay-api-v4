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
app.use(cors({
origin: "*",
methods: ["GET", "POST", "OPTIONS"],
allowedHeaders: ["Content-Type", "Accept", "Authorization"]
}));

app.options("*", cors());

// IMPORTANT: JSON parser ONCE
app.use(express.json({ limit: "2mb" }));

console.log(
"📮 USPS_USER_ID exists?",
!!process.env.USPS_USER_ID,
"length:",
(process.env.USPS_USER_ID || "").length
);


/* --------------------------- GOOGLE APPS SCRIPTS -------------------------- */
/** MAIN UPLOAD LOG (Tax Lakay - Upload Log) */
const UPLOAD_SHEET_URL =
'https://script.google.com/macros/s/AKfycbwE3mqUIwT232GBlrisxD7v7fqvWeCo1Q0dO2mROJISnlxdfvR0q6EOpD_WRMEQqvA/exec';

/** PRIVATE SSN LOGGER (Social Security - Upload Log) */
const PRIVATE_SHEET_URL =
'https://script.google.com/macros/s/AKfycby-RtiBJGTPucvcm-HZEJtkL05mMcWSGaezfBcjA0IdLuGLpstSPbQiBQXW7hs8DsCkGA/exec';

/** BANK INFO LOG (Bank Info – Upload Log) */
const BANK_SHEET_URL =
process.env.BANK_SHEET_URL ||
'https://script.google.com/macros/s/AKfycbxGQdl6L5V-Ik5dqDKI0yTCyhl-k6i8duZqIqN_YWa7EQm1gr7sQhzE9YU9EAEUSYQvSw/exec';

/* --------------------------- Google Drive Setup (Service Account) --------------------------- */

// Your specific configuration
const PERSONAL_EMAIL = 'lakaytax@gmail.com'; // Your personal email
const TARGET_FOLDER_NAME = 'TaxLakay-Client Uploads'; // The folder you want files in
const GOOGLE_SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '';
const GOOGLE_PRIVATE_KEY = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');

let drive = null;
let targetFolderId = null; // Will store the ID of "TaxLakay-Client Uploads"

(async function initDrive() {
try {
if (!GOOGLE_SERVICE_ACCOUNT_EMAIL || !GOOGLE_PRIVATE_KEY) {
console.warn('⚠️ Google Drive Service Account not fully configured. Skipping Drive uploads.');
return;
}

// Authenticate service account
const auth = new google.auth.JWT(
GOOGLE_SERVICE_ACCOUNT_EMAIL,
null,
GOOGLE_PRIVATE_KEY,
['https://www.googleapis.com/auth/drive'] // Full drive access
);

drive = google.drive({ version: 'v3', auth });
console.log('✅ Google Drive Service Account initialized');
console.log('👤 Service account:', GOOGLE_SERVICE_ACCOUNT_EMAIL);
console.log('📧 Will share files with:', PERSONAL_EMAIL);
console.log('📁 Target folder:', TARGET_FOLDER_NAME);

// Step 1: Find or create the target folder
targetFolderId = await findOrCreateFolder(TARGET_FOLDER_NAME);

if (!targetFolderId) {
console.error('❌ Failed to setup target folder. Uploads will not work.');
return;
}

console.log(`🎯 Target folder ID set to: ${targetFolderId}`);
console.log(`🔗 Folder link: https://drive.google.com/drive/folders/${targetFolderId}`);

} catch (e) {
console.error('❌ Failed to initialize Google Drive:', e.message);
drive = null;
targetFolderId = null;
}
})();

/**
* Find or create the target folder "TaxLakay-Client Uploads"
* Returns folder ID or null if failed
*/
async function findOrCreateFolder(folderName) {
if (!drive) {
console.error('❌ Drive not initialized');
return null;
}

try {
console.log(`🔍 Searching for folder: "${folderName}"...`);

// Search for folder by name
const searchResponse = await drive.files.list({
q: `name='${folderName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
fields: 'files(id, name, parents, permissions)',
spaces: 'drive'
});

const folders = searchResponse.data.files;

if (folders && folders.length > 0) {
// Found existing folder
const existingFolder = folders[0];
console.log(`✅ Found existing folder: "${existingFolder.name}" (ID: ${existingFolder.id})`);

// Check if service account has access to this folder
await ensureFolderAccess(existingFolder.id);

return existingFolder.id;
} else {
// Create new folder
console.log(`📁 Creating new folder: "${folderName}"...`);

const folderMetadata = {
name: folderName,
mimeType: 'application/vnd.google-apps.folder'
};

const createResponse = await drive.files.create({
resource: folderMetadata,
fields: 'id, name, webViewLink'
});

const newFolder = createResponse.data;
console.log(`✅ Created new folder: "${newFolder.name}" (ID: ${newFolder.id})`);

// Share folder with your email
await shareFolderWithEmail(newFolder.id, PERSONAL_EMAIL, 'writer');

return newFolder.id;
}

} catch (error) {
console.error('❌ Error finding/creating folder:', error.message);
return null;
}
}

/**
* Ensure service account has access to the folder
*/
async function ensureFolderAccess(folderId) {
try {
// First, try to access the folder
await drive.files.get({
fileId: folderId,
fields: 'id, name, capabilities'
});

console.log('✅ Service account has access to folder');

// Check if folder is already shared with your email
await checkAndAddSharing(folderId);

return true;
} catch (error) {
if (error.code === 404 || error.code === 403) {
console.warn('⚠️ Service account cannot access folder directly');
console.log('👉 To fix this:');
console.log(`1. Open Google Drive as ${PERSONAL_EMAIL}`);
console.log(`2. Find folder "${TARGET_FOLDER_NAME}"`);
console.log(`3. Click "Share"`);
console.log(`4. Add email: ${GOOGLE_SERVICE_ACCOUNT_EMAIL}`);
console.log('5. Set permission to "Editor"');
}
return false;
}
}

/**
* Check if folder is shared with your email, if not, share it
*/
async function checkAndAddSharing(folderId) {
try {
// List current permissions
const permissions = await drive.permissions.list({
fileId: folderId,
fields: 'permissions(emailAddress, role)'
});

const existingPermissions = permissions.data.permissions || [];
const alreadyShared = existingPermissions.some(
p => p.emailAddress === PERSONAL_EMAIL
);

if (!alreadyShared) {
console.log(`📤 Sharing folder with ${PERSONAL_EMAIL}...`);
await shareFolderWithEmail(folderId, PERSONAL_EMAIL, 'writer');
} else {
console.log(`✅ Folder already shared with ${PERSONAL_EMAIL}`);
}
} catch (error) {
console.warn('⚠️ Could not check folder permissions:', error.message);
}
}

/**
* Share a file/folder with a specific email
*/
async function shareFolderWithEmail(fileId, email, role = 'writer') {
try {
const permission = {
type: 'user',
role: role,
emailAddress: email
};

await drive.permissions.create({
fileId: fileId,
resource: permission,
sendNotificationEmail: true, // Optional: send email notification
fields: 'id'
});

console.log(`✅ Folder shared with ${email} (${role})`);
return true;
} catch (error) {
console.error(`❌ Failed to share with ${email}:`, error.message);
return false;
}
}

/**
* Upload file to "TaxLakay-Client Uploads" folder
* This is the main function you'll call to upload files
*/
async function uploadToTaxLakayFolder(filePath, fileName = null, mimeType = null) {
// Wait for initialization if needed
if (!drive || !targetFolderId) {
console.error('❌ Drive not initialized or target folder not found');
console.log('⏳ Waiting for initialization...');
await new Promise(resolve => setTimeout(resolve, 1000));

if (!drive || !targetFolderId) {
throw new Error('Google Drive not initialized. Please check service account credentials.');
}
}

try {
// Determine file name
const finalFileName = fileName || filePath.split('/').pop();
const finalMimeType = mimeType || getMimeType(filePath);

console.log(`📤 Uploading "${finalFileName}" to "TaxLakay-Client Uploads"...`);

// File metadata - CRITICAL: include parents field
const fileMetadata = {
name: finalFileName,
parents: [targetFolderId] // This puts file in YOUR folder
};

const media = {
mimeType: finalMimeType,
body: fs.createReadStream(filePath)
};

// Upload file
const uploadResponse = await drive.files.create({
resource: fileMetadata,
media: media,
fields: 'id, name, webViewLink, webContentLink, size'
});

const uploadedFile = uploadResponse.data;

console.log(`✅ File uploaded successfully!`);
console.log(`📄 File: ${uploadedFile.name}`);
console.log(`🆔 File ID: ${uploadedFile.id}`);
console.log(`🔗 View link: ${uploadedFile.webViewLink}`);
console.log(`🔗 Direct download: ${uploadedFile.webContentLink}`);
console.log(`📁 Located in: TaxLakay-Client Uploads`);

// Optional: Also share the individual file
await shareFolderWithEmail(uploadedFile.id, PERSONAL_EMAIL, 'writer');

return {
success: true,
fileId: uploadedFile.id,
fileName: uploadedFile.name,
fileLink: uploadedFile.webViewLink,
downloadLink: uploadedFile.webContentLink,
folderName: TARGET_FOLDER_NAME,
folderId: targetFolderId
};

} catch (error) {
console.error('❌ Upload failed:', error.message);

// Diagnostic help
if (error.message.includes('parents')) {
console.error('💡 TIP: Make sure "parents" field includes the correct folder ID');
console.error(`Current folder ID: ${targetFolderId}`);
}

if (error.message.includes('permission')) {
console.error('🔒 Permission issue detected');
console.error(`Share folder ${targetFolderId} with ${GOOGLE_SERVICE_ACCOUNT_EMAIL}`);
}

return {
success: false,
error: error.message
};
}
}

/**
* Get MIME type based on file extension
*/
function getMimeType(filePath) {
const extension = filePath.split('.').pop().toLowerCase();
const mimeTypes = {
'pdf': 'application/pdf',
'jpg': 'image/jpeg',
'jpeg': 'image/jpeg',
'png': 'image/png',
'txt': 'text/plain',
'csv': 'text/csv',
'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
'xls': 'application/vnd.ms-excel',
'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
'doc': 'application/msword',
'zip': 'application/zip'
};

return mimeTypes[extension] || 'application/octet-stream';
}

/**
* List all files in "TaxLakay-Client Uploads"
*/
async function listFilesInTaxLakayFolder() {
if (!drive || !targetFolderId) {
console.error('❌ Drive not initialized');
return [];
}

try {
console.log(`📂 Listing files in "${TARGET_FOLDER_NAME}":`);

const response = await drive.files.list({
q: `'${targetFolderId}' in parents and trashed=false`,
fields: 'files(id, name, mimeType, size, createdTime, modifiedTime)',
orderBy: 'createdTime desc',
pageSize: 100
});

const files = response.data.files;

if (files.length === 0) {
console.log('📭 Folder is empty');
} else {
files.forEach((file, index) => {
const size = file.size ? `${(file.size / 1024).toFixed(1)} KB` : 'N/A';
console.log(`${index + 1}. ${file.name} (${size}) - Created: ${file.createdTime}`);
});
}

return files;
} catch (error) {
console.error('❌ Failed to list files:', error.message);
return [];
}
}

/**
* Diagnostic function - Run this if files aren't appearing
*/
async function diagnoseUploadIssue() {
console.log('🔍 Running diagnostic...\n');

// Step 1: Check authentication
console.log('1. Checking authentication...');
if (!drive) {
console.log('❌ Drive service not initialized');
console.log(' Check GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_PRIVATE_KEY');
return;
}
console.log('✅ Drive service active\n');

// Step 2: Check target folder
console.log('2. Checking target folder...');
if (!targetFolderId) {
console.log('❌ Target folder ID not found');
targetFolderId = await findOrCreateFolder(TARGET_FOLDER_NAME);
if (!targetFolderId) {
console.log('❌ Failed to setup folder');
return;
}
}
console.log(`✅ Target folder: ${TARGET_FOLDER_NAME} (ID: ${targetFolderId})\n`);

// Step 3: Check folder access
console.log('3. Checking folder access...');
try {
const folder = await drive.files.get({
fileId: targetFolderId,
fields: 'id, name, capabilities, permissions'
});
console.log(`✅ Can access folder: ${folder.data.name}`);
console.log(`✅ Can upload files: ${folder.data.capabilities.canEdit}\n`);
} catch (error) {
console.log(`❌ Cannot access folder: ${error.message}`);
console.log(`👉 Share folder with: ${GOOGLE_SERVICE_ACCOUNT_EMAIL}\n`);
return;
}

// Step 4: List current files
console.log('4. Listing existing files...');
await listFilesInTaxLakayFolder();
console.log('');

// Step 5: Test upload (if you have a test file)
console.log('5. Ready to upload files');
console.log(' Call: uploadToTaxLakayFolder("path/to/your/file.pdf")');
}

/**
* Quick upload function for common use cases
*/
async function uploadClientDocument(clientName, documentType, filePath) {
const timestamp = new Date().toISOString().split('T')[0];
const fileName = `${clientName}_${documentType}_${timestamp}.${filePath.split('.').pop()}`;

console.log(`👤 Processing upload for ${clientName}...`);

const result = await uploadToTaxLakayFolder(filePath, fileName);

if (result.success) {
console.log(`✅ Document uploaded for ${clientName}`);
console.log(`🔗 ${result.fileLink}`);
}

return result;
}

// Export functions
module.exports = {
// Core functions
uploadToTaxLakayFolder,
listFilesInTaxLakayFolder,

// Utility functions
diagnoseUploadIssue,
uploadClientDocument,

// Getters
getTargetFolderId: () => targetFolderId,
getTargetFolderName: () => TARGET_FOLDER_NAME,

// Initialization check
isDriveReady: () => !!(drive && targetFolderId)
};

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
// Check if folder already exists in *My Drive* parent folder
const listRes = await drive.files.list({
q: `'${DRIVE_PARENT_FOLDER_ID}' in parents and mimeType = 'application/vnd.google-apps.folder' and name = '${folderName.replace(
/'/g,
"\\'"
)}' and trashed = false`,
fields: 'files(id, name)',
pageSize: 1,
});

if (listRes.data.files && listRes.data.files.length > 0) {
console.log(`📁 Found existing Drive folder for ${ref}: ${folderName}`);
return listRes.data.files[0].id;
}

// Create new folder in the parent folder (My Drive)
const createRes = await drive.files.create({
requestBody: {
name: folderName,
mimeType: 'application/vnd.google-apps.folder',
parents: [DRIVE_PARENT_FOLDER_ID],
},
fields: 'id',
});

console.log(`📁 Created Drive folder for ${ref}: ${folderName}`);
return createRes.data.id;
} catch (e) {
console.error('❌ ensureClientFolder failed:', e.message);
return null;
}
}

async function uploadFilesToDrive(folderId, files, meta = {}) {
if (!drive || !folderId || !Array.isArray(files) || files.length === 0) {
console.log('📭 Skipping Drive upload - missing requirements');
return;
}

console.log(`📤 Starting upload of ${files.length} files to Drive folder: ${folderId}`);

for (const file of files) {
try {
const fileName = sanitizeName(file.originalname) || 'document';
console.log(`⬆️ Uploading file: ${fileName}`);

const fileMetadata = {
name: fileName,
parents: [folderId],
description: `TaxLakay upload — Ref: ${meta.ref || ''}, Name: ${
meta.clientName || ''
}, Email: ${meta.clientEmail || ''}`,
};

const media = {
mimeType: file.mimetype,
body: Buffer.isBuffer(file.buffer)
? require('stream').Readable.from(file.buffer)
: file.buffer,
};

const res = await drive.files.create({
requestBody: fileMetadata,
media,
fields: 'id, name, webViewLink',
});

console.log(`✅ Uploaded to Drive: ${res.data.name} (${res.data.id})`);
console.log(`🔗 View: ${res.data.webViewLink}`);
} catch (e) {
console.error(`❌ Failed to upload file ${file.originalname}:`, e.message);
}
}
}

// Export functions if this is in its own module file
module.exports = {
drive,
ensureClientFolder,
uploadFilesToDrive,
sanitizeName,
};

/* =========================================================
SMARTY US ADDRESS VERIFICATION (SERVER)
Uses existing: const fetch = (...) => import('node-fetch')...
Uses existing: app.use(express.json(...))
Route stays: POST /api/usps-verify (frontend unchanged)
========================================================= */

function normalizeAddress(raw) {
return String(raw || "")
.trim()
.replace(/\r/g, "")
.replace(/\n+/g, ", ")
.replace(/\s+/g, " ")
.replace(/\s*,\s*/g, ", ")
.trim();
}

function formatLines(line1, line2) {
return [line1, line2].filter(Boolean).join("\n").trim();
}

async function verifyWithSmarty(rawAddress) {
const enteredLine = normalizeAddress(rawAddress);

const AUTH_ID = process.env.SMARTY_AUTH_ID;
const AUTH_TOKEN = process.env.SMARTY_AUTH_TOKEN;
const LICENSE = process.env.SMARTY_LICENSE || "us-core-cloud";

if (!AUTH_ID || !AUTH_TOKEN) {
return {
ok: true,
found: false,
showBox: true,
enteredLine,
recommendedLine: enteredLine,
message: "Address verification unavailable. Please confirm your address."
};
}

const url =
"https://us-street.api.smartystreets.com/street-address" +
`?auth-id=${encodeURIComponent(AUTH_ID)}` +
`&auth-token=${encodeURIComponent(AUTH_TOKEN)}` +
`&license=${encodeURIComponent(LICENSE)}` +
`&match=enhanced` +
`&candidates=1` +
`&street=${encodeURIComponent(enteredLine)}`;

try {
const resp = await fetch(url);
const data = await resp.json();

if (!Array.isArray(data) || data.length === 0) {
return {
ok: true,
found: false,
showBox: true,
enteredLine,
recommendedLine: enteredLine,
message: "No verified match found. Please confirm your address."
};
}

const c = data[0];
const recommendedLine = formatLines(c.delivery_line_1, c.last_line);

return {
ok: true,
found: true,
showBox: true,
enteredLine,
recommendedLine,
message: ""
};
} catch (err) {
console.error("SMARTY ERROR:", err);
return {
ok: true,
found: false,
showBox: true,
enteredLine,
recommendedLine: enteredLine,
message: "Address verification temporarily unavailable."
};
}
}

/* ✅ ROUTE (NO require("express").json() here) */
app.post("/api/usps-verify", async (req, res) => {
try {
const address = String(req.body?.address || "").trim();

if (!address) {
return res.json({
ok: false,
found: false,
showBox: true,
enteredLine: "",
recommendedLine: "",
message: "Address is required"
});
}

const result = await verifyWithSmarty(address);
return res.json(result);

} catch (e) {
console.error("SMARTY VERIFY ROUTE ERROR:", e);
return res.json({
ok: true,
found: false,
showBox: true,
enteredLine: String(req.body?.address || ""),
recommendedLine: String(req.body?.address || ""),
message: "Address verification failed. Please confirm your address."
});
}
});

/* ----------------------------- CORS (unified) ----------------------------- */
const ALLOWED_HOSTS = new Set([
'www.taxlakay.com',
'taxlakay.com',
'sites.google.com'
]);

function isAllowedOrigin(origin) {
// Allow requests with no origin (Render health checks, curl, server-to-server)
if (!origin) return true;

const allowed = [
'https://www.taxlakay.com',
'https://taxlakay.com',
'https://sites.google.com',
'https://www.sites.google.com'
];

// Allow any Google Sites subdomain
if (origin.startsWith('https://sites.google.com')) return true;

// ✅ Allow Google embed/frames origins
if (origin.includes('googleusercontent.com')) return true;

return allowed.includes(origin);
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
console.warn(`⚠️ Email template not found: ${filePath}`);
return null;
}
return fs.readFileSync(filePath, 'utf8');
} catch (E) {
console.error('❌ Failed to load email template:', E);
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

// ✅ Correct format: TL + 6 digits (e.g., TL929402)
const pattern = /^TL\d{6}$/;

if (!pattern.test(ref)) {
return res.json({
ok: false,
message: "Please enter a valid Reference ID from your Tax Lakay upload receipt."
});
}

// ✅ Only accept IDs that actually exist in uploads_log.csv
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
console.error('❌ USPS validation for upload form failed:', e);
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
console.warn(`⚠️ No Drive folder created for ref ${referenceNumber}`);
}
} catch (e) {
console.error('❌ Drive upload block failed:', e);
}
/* === Upload Log → Apps Script (WORKING + MATCHES SCRIPT) =================== */
if (UPLOAD_SHEET_URL) {
try {
// 👇 Define the service text that will go to the "Service" column
const serviceValue =
returnType && returnType.trim()
? `Tax Preparation — ${returnType.trim()}`
: 'Tax Preparation — $150 Flat';

const sheetPayload = {
timestamp: new Date().toISOString(), // Timestamp
referenceId: referenceNumber, // Reference ID
clientName: clientName || "", // Client Name
clientEmail: clientEmail || "", // Client Email
clientPhone: clientPhone || "", // Client Phone
service: serviceValue, // 👈 THIS is what Apps Script reads
returnType: returnType || "", // Return Type
dependents: dependents || "", // Dependents
cashAdvance: cashAdvance || "", // CashAdvance
refundMethod: refundMethod || "", // RefundMethod
currentAddress: currentAddress || clientAddress || "",
filesCount: (req.files || []).length, // Files count
fileNames: (req.files || []).map(f => f.originalname).join(", "), // Files
source: "Upload Form", // Source
language: lang, // PreferedLanguage
message: clientMessage || "" // Message
};

const r = await fetch(UPLOAD_SHEET_URL, {
method: "POST",
headers: { "Content-Type": "application/json" },
body: JSON.stringify(sheetPayload)
});

const text = await r.text();
let j = {};
try { j = text ? JSON.parse(text) : {}; } catch (_) {}

if (!r.ok || j.ok === false) {
console.error("❌ Upload Sheet logger error:", j.error || text);
} else {
console.log("✅ Upload Log row added");
}
} catch (e) {
console.error("❌ Failed calling Upload Sheet logger:", e);
}
} else {
console.warn("⚠️ UPLOAD_SHEET_URL not set; skipping sheet log.");
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
📧 <a href="mailto:lakaytax@gmail.com">lakaytax@gmail.com</a> &nbsp;|&nbsp;
📞 <a href="tel:18639344823">(863) 934-4823</a> &nbsp;|&nbsp;
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

/* ---------------- Email to CLIENT (templates) ---------------- */
let clientEmailSent = false;
if (clientEmail) {
const clientSubject = "We've Received Your Documents — Tax Lakay";

const clientEmailText = `
Hi ${clientName || 'Valued Customer'},

Thank you so much for choosing Tax Lakay! 🎉
We've received your documents and will start preparing your tax return shortly.
If we need any additional information, we'll reach out right away.

Your reference number is ${referenceNumber}.

You can check your filing status anytime using your Reference ID at:
https://www.taxlakay.com/filing-status

Warm regards,
The Tax Lakay Team
📧 lakaytax@gmail.com
📞 (863) 934-4823
💻 https://www.taxlakay.com
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
console.error('❌ Error applying email template:', e);
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
<p>Thank you so much for choosing Tax Lakay! 🎉</p>
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
📧 <a href="mailto:lakaytax@gmail.com" style="color: #1e63ff;">lakaytax@gmail.com</a> &nbsp;
📞 <a href="tel:3179359067" style="color: #1e63ff;">(863) 934-4823</a><br>
💻 <a href="https://www.taxlakay.com" style="color: #1e63ff;">www.taxlakay.com</a>
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
console.log('✅ Client confirmation email sent to:', clientEmail);
console.log('📎 Files attached:', sendClientReceipt);
} catch (emailError) {
console.error('❌ Failed to send client email:', emailError);
}
}

await transporter.sendMail(adminEmail);
console.log('✅ Admin notification email sent to', adminTo);

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
.text('📞 (863) 934-4823 | 🌐 www.taxlakay.com | 📧 lakaytax@gmail.com', {
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

console.log('✅ Admin SSN notification email sent to lakaytax@gmail.com');
} catch (emailErr) {
console.error('❌ Failed to send SSN admin email:', emailErr);
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
const {
referenceId,
clientName,
clientEmail,
clientPhone,
currentAddress,
bankName,
accountType,
routingNumber,
accountNumber,
comments,
addressConfirmed,
fullAddress
} = req.body || {};

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
}

const effectiveAddress = fullAddress || currentAddress || '';

// 👉 We keep last 4 ONLY for display (receipt), but not for the sheet
const routingLast4 = routingNumber ? String(routingNumber).slice(-4) : '';
const accountLast4 = accountNumber ? String(accountNumber).slice(-4) : '';

/* === BANK LOG → Apps Script (FULL NUMBERS to your sheet) ============= */
if (BANK_SHEET_URL) {
try {
const bankPayload = {
timestamp: new Date().toISOString(),
referenceId: referenceId || '',
clientName: clientName || '',
clientEmail: clientEmail || '',
clientPhone: clientPhone || '',
currentAddress: currentAddress || '',
bankName: bankName || '',
accountType: accountType || '',

// ✅ FULL values (this is what your Apps Script reads)
routingNumber: routingNumber ? String(routingNumber) : '',
accountNumber: accountNumber ? String(accountNumber) : '',

comments: comments || '',
addressConfirmed: addressConfirmed || '',
fullAddress: effectiveAddress
};

console.log('📤 Sending bankPayload to Apps Script:', bankPayload);

const r = await fetch(BANK_SHEET_URL, {
method: 'POST',
headers: { 'Content-Type': 'application/json' },
body: JSON.stringify(bankPayload)
});

const text = await r.text();
let j = {};
try { j = text ? JSON.parse(text) : {}; } catch (_) {}

if (!r.ok || j.ok === false) {
console.error('❌ Bank Log logger error:', j.error || text);
} else {
console.log('✅ Bank Log row added');
}
} catch (e) {
console.error('❌ Bank Log failed:', e);
}
} else {
console.warn('⚠️ BANK_SHEET_URL not set; skipping bank log.');
}

// ---------- Step 3: send admin email (MASKED) ----------
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
They are stored only in your secure Google Sheet.
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

console.log('✅ Bank info admin email sent to', adminTo);

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
console.log(`ℹ️ No email found for ref ${ref}, skipping status email.`);
return;
}

const transporter = createTransporter();
const safeStage = stage || 'Updated';
const safeName = client.name || 'Valued Customer';

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

If you have any questions, you can reply to this email or call us at (863) 934-4823.

Warm regards,
Tax Lakay
📧 lakaytax@gmail.com
📞 (863) 934-4823
💻 https://www.taxlakay.com
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
🔗 <a href="https://www.taxlakay.com/filing-status" style="color:#1e63ff;font-weight:bold;">
https://www.taxlakay.com/filing-status
</a><br>
<span style="font-size:13px;color:#4b5563;">
(Enter your Reference ID: <span style="font-family:monospace;">${ref}</span>)
</span>
</p>

<p style="font-size:14px;">
If you have any questions, you can reply to this email or call us at
<strong>(863) 934-4823</strong>.
</p>

<hr style="border:none;border-top:1px solid #e5e7eb;margin:18px 0;">

<p style="text-align:center;font-size:13px;color:#64748b;margin:0;">
📧 <a href="mailto:lakaytax@gmail.com" style="color:#1e63ff;">lakaytax@gmail.com</a> &nbsp;|&nbsp;
📞 <a href="tel:18639344823" style="color:#1e63ff;">(863) 934-4823</a> &nbsp;|&nbsp;
💻 <a href="https://www.taxlakay.com" style="color:#1e63ff;">www.taxlakay.com</a>
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
console.log(`📧 Status email sent to ${client.email} for ref ${ref}`);
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
console.log(`🚀 Tax Lakay Backend running on port ${PORT}`);
console.log(`✅ Health check: http://localhost:${PORT}/health`);
});
