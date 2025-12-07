require("dotenv").config();
const { google } = require("googleapis");
const readline = require("readline");

// Load env variables
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI;

// Google OAuth2 client
const oauth2Client = new google.auth.OAuth2(
CLIENT_ID,
CLIENT_SECRET,
REDIRECT_URI
);

// Step 1: generate URL
function startAuth() {
const url = oauth2Client.generateAuthUrl({
access_type: "offline",
scope: ["https://www.googleapis.com/auth/drive.file"],
prompt: "consent",
});

console.log("\nSTEP 1: Open this URL in your browser:\n");
console.log(url);
console.log("\n-----------------------------------------\n");
console.log("STEP 2: Sign in, click Allow, then copy the FULL URL");
console.log("-----------------------------------------\n");

askForCode();
}

// Step 2: wait for pasted URL
function askForCode() {
const rl = readline.createInterface({
input: process.stdin,
output: process.stdout,
});

rl.question("STEP 3: Paste the FULL URL here:\n", async (answer) => {
rl.close();

try {
const code = new URL(answer).searchParams.get("code");
const { tokens } = await oauth2Client.getToken(code);

console.log("\n✅ REFRESH TOKEN:");
console.log(tokens.refresh_token);

console.log("\n⚠️ Save this refresh token into your Render env variable:");
console.log("GOOGLE_REFRESH_TOKEN = " + tokens.refresh_token);
} catch (err) {
console.error("\n❌ ERROR retrieving token:", err.message);
}
});
}

startAuth();
