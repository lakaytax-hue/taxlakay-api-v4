/* =========================================================
USPS ADDRESS VALIDATION — POPUP-READY RESPONSE
- Handles commas OR no commas
- ZIP optional (better if provided)
- Always returns: showBox, found, enteredLine, recommendedLine, message
========================================================= */

const STATE_MAP = {
AL:'AL', ALABAMA:'AL', AK:'AK', ALASKA:'AK', AZ:'AZ', ARIZONA:'AZ', AR:'AR', ARKANSAS:'AR',
CA:'CA', CALIFORNIA:'CA', CO:'CO', COLORADO:'CO', CT:'CT', CONNECTICUT:'CT', DE:'DE', DELAWARE:'DE',
DC:'DC', DISTRICTOFCOLUMBIA:'DC',
FL:'FL', FLORIDA:'FL', GA:'GA', GEORGIA:'GA', HI:'HI', HAWAII:'HI', ID:'ID', IDAHO:'ID',
IL:'IL', ILLINOIS:'IL', IN:'IN', INDIANA:'IN', IA:'IA', IOWA:'IA', KS:'KS', KANSAS:'KS',
KY:'KY', KENTUCKY:'KY', LA:'LA', LOUISIANA:'LA', ME:'ME', MAINE:'ME', MD:'MD', MARYLAND:'MD',
MA:'MA', MASSACHUSETTS:'MA', MI:'MI', MICHIGAN:'MI', MN:'MN', MINNESOTA:'MN', MS:'MS', MISSISSIPPI:'MS',
MO:'MO', MISSOURI:'MO', MT:'MT', MONTANA:'MT', NE:'NE', NEBRASKA:'NE', NV:'NV', NEVADA:'NV',
NH:'NH', NEWHAMPSHIRE:'NH', NJ:'NJ', NEWJERSEY:'NJ', NM:'NM', NEWMEXICO:'NM', NY:'NY', NEWYORK:'NY',
NC:'NC', NORTHCAROLINA:'NC', ND:'ND', NORTHDAKOTA:'ND', OH:'OH', OHIO:'OH', OK:'OK', OKLAHOMA:'OK',
OR:'OR', OREGON:'OR', PA:'PA', PENNSYLVANIA:'PA', RI:'RI', RHODEISLAND:'RI', SC:'SC', SOUTHCAROLINA:'SC',
SD:'SD', SOUTHDAKOTA:'SD', TN:'TN', TENNESSEE:'TN', TX:'TX', TEXAS:'TX', UT:'UT', UTAH:'UT',
VT:'VT', VERMONT:'VT', VA:'VA', VIRGINIA:'VA', WA:'WA', WASHINGTON:'WA', WV:'WV', WESTVIRGINIA:'WV',
WI:'WI', WISCONSIN:'WI', WY:'WY', WYOMING:'WY'
};

function normStateToken(token) {
const t = String(token || '').toUpperCase().replace(/[^A-Z]/g, '');
return STATE_MAP[t] || '';
}

function escapeXml(s) {
return String(s || '')
.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
.replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function normalizeAddr(s) {
return String(s || '')
.toUpperCase()
.replace(/[.,#]/g, ' ')
.replace(/\s+/g, ' ')
.trim();
}

function formatAddressLine(street, city, state, zip5, zip4) {
const zip = [zip5, zip4].filter(Boolean).join('-');
const line1 = street || '';
const line2 = [city, state, zip].filter(Boolean).join(' ');
return [line1, line2].filter(Boolean).join('\n').trim();
}

/**
* parseUSAddress(raw)
* Accepts:
* - "929 Gilmore Ave Apt 2, Lakeland, FL 33801"
* - "929 Gilmore Ave Apt 2 Lakeland FL 33801"
* ZIP optional (still returns street/city/state when possible)
*/
function parseUSAddress(raw) {
const s = String(raw || '').trim().replace(/\s+/g, ' ');
if (!s) return null;

// Try ZIP at end (optional)
let zip5 = '';
let zip4 = '';
const zipMatch = s.match(/(\d{5})(?:-(\d{4}))?\s*$/);
let base = s;

if (zipMatch) {
zip5 = zipMatch[1] || '';
zip4 = zipMatch[2] || '';
base = s.replace(/(\d{5})(?:-\d{4})?\s*$/, '').trim();
}

// If commas exist, prefer: street, city, state
if (base.includes(',')) {
const parts = base.split(',').map(x => x.trim()).filter(Boolean);
if (parts.length >= 3) {
const street = parts[0];
const city = parts[1];
const state = normStateToken(parts[2]);
if (street && city && state) return { street, city, state, zip5, zip4 };
}
}

// No commas: find state token near the end
const tokens = base.split(' ').filter(Boolean);
if (tokens.length < 3) return null;

// Find a state token scanning backward (last ~4 tokens)
let stateIndex = -1;
let state = '';
for (let i = tokens.length - 1; i >= Math.max(0, tokens.length - 4); i--) {
const st = normStateToken(tokens[i]);
if (st) { state = st; stateIndex = i; break; }
}
if (!state) return null;

// City is token(s) right before state (at least 1 word)
const cityTokens = [];
if (stateIndex - 1 < 0) return null;
cityTokens.unshift(tokens[stateIndex - 1]);

// Street is everything before city
const streetTokens = tokens.slice(0, stateIndex - 1);
const street = streetTokens.join(' ').trim();
const city = cityTokens.join(' ').trim();

if (!street || !city || !state) return null;
return { street, city, state, zip5, zip4 };
}

async function verifyAddressWithUSPS(rawAddress) {
const userId = process.env.USPS_USER_ID;
if (!userId) {
return { ok:false, found:false, showBox:true, message:'Missing USPS_USER_ID', enteredLine: rawAddress || '' };
}

const parsed = parseUSAddress(rawAddress);
if (!parsed) {
// Still show popup so user can correct it (instead of silent pass)
return {
ok:true,
found:false,
showBox:true,
message:'Please enter address like: "Street, City, ST ZIP".',
enteredLine: String(rawAddress || '').trim()
};
}

const { street, city, state, zip5 } = parsed;

// Build entered line for popup
const enteredLine = formatAddressLine(street, city, state, zip5, '');

// USPS Verify (AddressValidate)
const xml = `
<AddressValidateRequest USERID="${escapeXml(userId)}">
<Revision>1</Revision>
<Address ID="0">
<Address1></Address1>
<Address2>${escapeXml(street)}</Address2>
<City>${escapeXml(city)}</City>
<State>${escapeXml(state)}</State>
<Zip5>${escapeXml(zip5 || '')}</Zip5>
<Zip4></Zip4>
</Address>
</AddressValidateRequest>
`.trim();

const url = `https://secure.shippingapis.com/ShippingAPI.dll?API=Verify&XML=${encodeURIComponent(xml)}`;

try {
const resp = await fetch(url);
const text = await resp.text();

// If USPS returns <Error>, show popup but with "no match"
if (text.includes('<Error>')) {
const msg = (text.match(/<Description>([\s\S]*?)<\/Description>/i)?.[1] || 'USPS could not verify this address.').trim();
return { ok:true, found:false, showBox:true, message: msg, enteredLine, recommendedLine:'' };
}

const pick = (tag) => {
const m = text.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i'));
return m ? String(m[1] || '').trim() : '';
};

const addr2 = pick('Address2');
const cityR = pick('City');
const stateR = pick('State');
const zip5R = pick('Zip5');
const zip4R = pick('Zip4');

const found = !!(addr2 && cityR && stateR && zip5R);
const recommendedLine = found
? formatAddressLine(addr2, cityR, stateR, zip5R, zip4R)
: '';

// show popup if:
// - not found (so user can fix/continue)
// - OR found but different than entered
const showBox = !found ? true : (normalizeAddr(enteredLine) !== normalizeAddr(recommendedLine));

return {
ok:true,
found,
showBox,
message: found ? '' : 'No USPS match found. You can edit the address or continue.',
enteredLine,
recommendedLine
};
} catch (e) {
return { ok:false, found:false, showBox:true, message: e.message || 'USPS verify failed', enteredLine, recommendedLine:'' };
}
}

/* ---------------- USPS VERIFY ROUTE (POPUP-READY) ---------------- */
app.post('/api/usps-verify', express.json(), async (req, res) => {
try {
const entered = String(req.body?.address || '').trim();
if (!entered) return res.status(400).json({ ok:false, found:false, showBox:true, message:'Missing address', enteredLine:'', recommendedLine:'' });

const result = await verifyAddressWithUSPS(entered);

// Ensure the front-end always gets the fields it expects
return res.json({
ok: !!result.ok,
found: !!result.found,
showBox: !!result.showBox,
enteredLine: result.enteredLine || entered,
recommendedLine: result.recommendedLine || '',
message: result.message || ''
});
} catch (err) {
return res.json({ ok:false, found:false, showBox:true, message: err.message || 'Server error', enteredLine:'', recommendedLine:'' });
}
});
