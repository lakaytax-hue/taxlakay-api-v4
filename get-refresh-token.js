const { google } = require('googleapis');
const readline = require('readline');


const GOOGLE_OAUTH_CLIENT_ID = "987557178118-q0ob1ls9oi9mecql26ugh962v8htcvg.apps.googleusercontent.com";
const GOOGLE_OAUTH_CLIENT_SECRET = "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";
const GOOGLE_OAUTH_REDIRECT_URI = "http://localhost:3000/oauth2callback";

const oauth2Client = new google.auth.OAuth2(
GOOGLE_OAUTH_CLIENT_ID,
GOOGLE_OAUTH_CLIENT_SECRET,
GOOGLE_OAUTH_REDIRECT_URI
);

function startAuth() {
const authUrl = oauth2Client.generateAuthUrl({
access_type: 'offline',
prompt: 'consent',
scope: ['https://www.googleapis.com/auth/drive.file']
});

console.log("\nSTEP 1: Open this URL in Chrome:\n");
console.log(authUrl);
console.log("\nSTEP 2: Log in with lakaytax@gmail.com\n");

askForCode();
}

function askForCode() {
const rl = readline.createInterface({
input: process.stdin,
output: process.stdout,
});

rl.question("STEP 3: Paste the code here:\n", async (code) => {
rl.close();

try {
const { tokens } = await oauth2Client.getToken(code);
console.log("\n✅ REFRESH TOKEN:");
console.log(tokens.refresh_token);

console.log("\n⚠️ Save this in your Render ENV:");
console.log("GOOGLE_REFRESH_TOKEN=" + tokens.refresh_token);

} catch (err) {
console.error("\n❌ ERROR retrieving refresh token:");
console.error(err.message);
}
});
}

startAuth();
