from flask import Flask, request, jsonify
from werkzeug.utils import secure_filename
from flask_cors import CORS
import os, uuid, datetime, sys, yagmail

app = Flask(__name__)

ALLOW_ORIGIN = os.environ.get("ALLOW_ORIGIN", "*")
CORS(app, resources={r"/api/*": {"origins": ALLOW_ORIGIN}}, supports_credentials=False)

EMAIL_USER = os.environ.get("EMAIL_USER", "")
EMAIL_PASS = os.environ.get("EMAIL_PASS", "")
OWNER_EMAIL = os.environ.get("OWNER_EMAIL", "")

SEND_CLIENT_RECEIPT = os.environ.get("SEND_CLIENT_RECEIPT", "true").lower() in ("1","true","yes")

ALLOWED = {"application/pdf", "image/jpeg", "image/png"}
MAX_FILES = 10
MAX_FILE_BYTES = 20 * 1024 * 1024
MAX_TOTAL_BYTES = 22 * 1024 * 1024

def mailer():
    if not EMAIL_USER or not EMAIL_PASS:
        raise RuntimeError("Missing EMAIL_USER or EMAIL_PASS.")
    return yagmail.SMTP(EMAIL_USER, EMAIL_PASS)

def send_owner_email(ref, when, clientName, clientEmail, clientPhone, returnType, dependents, clientNote, attachments, details_lines):
    subject = f"New Tax Lakay upload — Ref {ref}"
    body = f"""New Tax Lakay upload received.

Ref: {ref}
When: {when}

Client: {clientName} <{clientEmail}>
Phone: {clientPhone or '(none provided)'}
Return Type: {returnType}
Dependents: {dependents}

Client Message:
{clientNote or '(no message)'} 

Files:
{os.linesep.join(details_lines)}

(These files were sent as email attachments at your request. No cloud storage was used.)
"""
    m = mailer()
    m.send(to=OWNER_EMAIL, subject=subject, contents=[body] + attachments)

def send_client_receipt(ref, when, clientName, clientEmail):
    if not SEND_CLIENT_RECEIPT or not clientEmail:
        return
    subject = f"Tax Lakay — We received your documents (Ref {ref})"
    body = f"""Hello {clientName or 'Client'},

This is a confirmation that Tax Lakay received your documents.
Reference ID: {ref}
Received: {when}

We will review your documents and contact you shortly.
If you have any questions, reply to this email or call (317) 935-9067.

— Tax Lakay
lakaytax@gmail.com
https://www.taxlakay.com
"""
    try:
        m = mailer()
        m.send(to=clientEmail, subject=subject, contents=body)
    except Exception as e:
        print("Client receipt email error:", e, file=sys.stderr)

@app.post("/api/upload")
def upload():
    clientName = (request.form.get("clientName") or "").strip()
    clientEmail = (request.form.get("clientEmail") or "").strip().lower()
    clientPhone = (request.form.get("clientPhone") or "").strip()
    clientNote  = (request.form.get("clientMessage") or "").strip()
    returnType = (request.form.get("returnType") or "").strip()
    dependents = (request.form.get("dependents") or "0").strip()

    files = request.files.getlist("documents")
    if not files:
        return jsonify({"ok": False, "error": "No files uploaded"}), 400
    if len(files) > MAX_FILES:
        return jsonify({"ok": False, "error": f"Too many files (max {MAX_FILES})"}), 400

    total_bytes = 0
    attachments = []
    details_lines = []

    for f in files:
        if f.mimetype not in ALLOWED:
            return jsonify({"ok": False, "error": f"Disallowed type: {f.mimetype}. Allowed: PDF, JPG, PNG"}), 400

        f.stream.seek(0, os.SEEK_END)
        size = f.stream.tell()
        f.stream.seek(0)
        if size > MAX_FILE_BYTES:
            return jsonify({"ok": False, "error": f"{f.filename} too large (max 20MB per file)"}), 400

        total_bytes += size
        if total_bytes > MAX_TOTAL_BYTES:
            return jsonify({"ok": False, "error": "Total attachment size too large for email (limit ~22MB). Please upload fewer/smaller files."}), 400

        filename = secure_filename(f.filename) or f"file-{uuid.uuid4().hex}"
        data = f.read()
        tmp_path = os.path.join("/tmp", f"{uuid.uuid4().hex}-{filename}")
        with open(tmp_path, "wb") as out:
            out.write(data)
        attachments.append(tmp_path)
        details_lines.append(f"• {filename} — {round(size/1024/1024,2)} MB — {f.mimetype}")

    ref = str(uuid.uuid4())
    when = datetime.datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S UTC")

    try:
        send_owner_email(ref, when, clientName, clientEmail, clientPhone, returnType, dependents, clientNote, attachments, details_lines)
        send_client_receipt(ref, when, clientName, clientEmail)
    except Exception as e:
        print("Email send error:", e, file=sys.stderr)
        return jsonify({"ok": False, "error": "Email send failed. Check EMAIL_USER/PASS and size limits."}), 500
    finally:
        try:
            for p in attachments:
                if os.path.exists(p):
                    os.remove(p)
        except Exception:
            pass

    return jsonify({
        "ok": True,
        "ref": ref,
        "clientName": clientName,
        "clientEmail": clientEmail,
        "clientPhone": clientPhone,
        "returnType": returnType,
        "dependents": dependents,
        "files": [os.path.basename(x) for x in attachments]
    })

@app.get("/api/health")
def health():
    have_email = bool(EMAIL_USER and EMAIL_PASS and OWNER_EMAIL)
    return jsonify({"ok": True, "email": have_email, "client_receipt": SEND_CLIENT_RECEIPT})

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 4000)))
