const { google } = require('googleapis');
const readline = require('readline');
require('dotenv').config();

async function getRefreshToken() {
console.log('🔐 Getting Google OAuth 2.0 Refresh Token\n');

const oauth2Client = new google.auth.OAuth2(
process.env.GOOGLE_CLIENT_ID,
process.env.GOOGLE_CLIENT_SECRET,
'http://localhost:3000/oauth2callback'
);

// Generate the URL for authorization
const authUrl = oauth2Client.generateAuthUrl({
access_type: 'offline',
scope: ['https://www.googleapis.com/auth/drive'],
prompt: 'consent'
});

console.log('══════════════════════════════════════════════════');
console.log('STEP 1: Open this URL in your browser:');
console.log('══════════════════════════════════════════════════\n');
console.log(authUrl);
console.log('\n══════════════════════════════════════════════════');
console.log('STEP 2: Follow these steps in your browser:');
console.log('══════════════════════════════════════════════════');
console.log('1. Sign in with: lakaytax@gmail.com');
console.log('2. Click "Allow" on the permission screen');
console.log('3. You will be redirected to a page that says');
console.log(' "This site can\'t be reached" - THIS IS NORMAL!');
console.log('4. Look at the URL in your browser address bar');
console.log('5. Copy the ENTIRE code from the URL');
console.log('\nExample URL:');
console.log('http://localhost:3000/oauth2callback?code=4/0AfJohXkfJd8k9...LONG_CODE...&scope=...');
console.log(' Copy this part → ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^');
console.log('\n══════════════════════════════════════════════════');

const rl = readline.createInterface({
input: process.stdin,
output: process.stdout
});

rl.question('\nSTEP 3: Paste the code here and press Enter: ', async (code) => {
rl.close();

try {
const { tokens } = await oauth2Client.getToken(code);

console.log('\n══════════════════════════════════════════════════');
console.log('✅ SUCCESS! Your refresh token is ready!');
console.log('══════════════════════════════════════════════════\n');
console.log('📋 YOUR REFRESH TOKEN:');
console.log('\n' + tokens.refresh_token + '\n');
console.log('📝 Add this to your .env file as:');
console.log('GOOGLE_REFRESH_TOKEN=' + tokens.refresh_token);
console.log('\n══════════════════════════════════════════════════');
console.log('🔧 Next steps:');
console.log('══════════════════════════════════════════════════');
console.log('1. Open your .env file');
console.log('2. Add this line:');
console.log(' GOOGLE_REFRESH_TOKEN=' + tokens.refresh_token);
console.log('3. Update your server code to use OAuth 2.0');
console.log('4. Restart your server');
console.log('5. Test file upload!');

// Test the token immediately
console.log('\n🧪 Testing the token now...');
await testToken(tokens.refresh_token);

} catch (error) {
console.error('\n❌ ERROR:', error.message);
console.log('\n🔧 Troubleshooting:');
console.log('• Make sure you copied the ENTIRE code');
console.log('• Try again - codes expire after a few minutes');
console.log('• Make sure you clicked "Allow" on all screens');
}
});
}

async function testToken(refreshToken) {
try {
const oauth2Client = new google.auth.OAuth2(
process.env.GOOGLE_CLIENT_ID,
process.env.GOOGLE_CLIENT_SECRET
);

oauth2Client.setCredentials({
refresh_token: refreshToken
});

const drive = google.drive({ version: 'v3', auth: oauth2Client });

// Try to access the folder
const folder = await drive.files.get({
fileId: process.env.GOOGLE_DRIVE_PARENT_FOLDER_ID || '16tx8uhyrq79K481-2Ey1SZz-ScRb5EJh',
fields: 'id, name'
});

console.log('\n🎉 Token test successful!');
console.log('✅ Connected to folder: "' + folder.data.name + '"');
console.log('\nYour OAuth 2.0 setup is ready!');

} catch (error) {
console.error('Token test failed:', error.message);
}
}

// Run the script
getRefreshToken();
