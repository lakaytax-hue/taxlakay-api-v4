Tax Lakay — Backend (Email-Only)

Sends uploaded files to OWNER_EMAIL via Gmail and (optionally) emails a confirmation to the client.

Deploy on Render (Starter $7/mo recommended)
--------------------------------------------
1) Go to https://render.com → New → Web Service.
2) Upload this ZIP file or connect the repo.
3) Instance Type: Starter ($7/mo).
4) Start Command: node index.js
5) Set Environment Variables:
   EMAIL_USER=lakaytax@gmail.com
   EMAIL_PASS=<Your Gmail App Password>
   OWNER_EMAIL=lakaytax@gmail.com
   ALLOW_ORIGIN=https://www.taxlakay.com
   SEND_CLIENT_RECEIPT=true

Notes
-----
- Accepts up to 10 files, each ≤ 20MB.
- Uses /tmp for temporary storage and cleans up after email is sent.
- Adds generous server timeouts to avoid "Network error" during cold starts.
- CORS is locked to https://www.taxlakay.com by default.
- Health check: GET / → "Tax Lakay Backend (Email-Only) — OK"

API
---
POST /api/upload
Form fields:
  files[]    - one or more files
  email      - (optional) client's email for receipt
  wantsReceipt - (optional) "true" (default) or "false"

Responses:
  200 { ok: true }
  4xx/5xx { ok: false, error: "message" }
