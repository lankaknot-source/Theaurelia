# The Aurelia 2K26 Ticketing System

> GitHub Pages note: this revision includes a browser import map and a static Pages workflow, so `qrcode`, Firebase, html5-qrcode and Three.js resolve even when the source tree is served directly. See `GITHUB-PAGES-SETUP.md`.

# The Aurelia 2K26 — Secure QR Ticketing System

Production-oriented web ticketing system for **The Aurelia 2K26** using HTML, Tailwind CSS, JavaScript, Three.js, Firebase Authentication, Cloud Firestore, Firebase Cloud Functions, QR codes and EmailJS.

## What is included

- Google/Gmail login only.
- Firebase project is already configured for `the-aurelia-2k26` in `src/firebase.js`.
- `lankaknot@gmail.com` is the protected primary admin.
- A full admin can promote/demote any signed-in user; the primary admin cannot be demoted.
- User chooses **2023 O/L Batch** or **2026 A/L Batch**.
- Registration: full name, correct batch class, ID number and LKR 5,500 bank payment slip.
- Bank slip is compressed in the browser to WebP and stored **inside Cloud Firestore**, not Firebase Storage.
- Because Firestore documents have a 1 MiB limit, the compressed image is split into approximately 700 KiB binary chunk documents under `paymentSlips/{slipId}/chunks/`.
- Admin viewer rebuilds the chunks and applies high-quality browser resampling/contrast enhancement for clearer inspection. Compression cannot recreate detail that was never captured in the source photo.
- Admin reviews payment proof, enters a unique ticket number and approves.
- Approval creates a cryptographically random QR token.
- QR ticket is emailed through EmailJS and is also shown in the logged-in portal.
- QR scanner is admin-only.
- First successful gate scan atomically changes the ticket to `USED`; repeat scans show `ALREADY USED`.
- Ticket number uniqueness is enforced in Firestore transaction logic.

## Firebase project already configured

```text
Project ID: the-aurelia-2k26
Auth domain: the-aurelia-2k26.firebaseapp.com
Storage bucket: the-aurelia-2k26.firebasestorage.app
Functions region: asia-south1
```

The Firebase Web API key/config supplied for this app is already in `src/firebase.js`. Firebase web configuration is client-visible by design; actual access is protected with Authentication, Security Rules and server-side admin claims.

## Firebase Console setup

1. Firebase Console → **Authentication** → Sign-in method → enable **Google**.
2. Firebase Console → **Firestore Database** → create the database.
3. If Firebase asks for an authorized domain, add your Firebase Hosting/custom domain.
4. Use a billing plan that supports the Cloud Functions setup you deploy.

## EmailJS setup

The app deliberately does **not** place the EmailJS private key in browser JavaScript. Email is sent from a Firebase Cloud Function.

You need four EmailJS values:

- Service ID
- Template ID
- Public Key
- Private Key

Save them to Firebase Secret Manager by running:

```bash
./scripts/configure-emailjs.sh
```

or manually:

```bash
firebase functions:secrets:set EMAILJS_SERVICE_ID
firebase functions:secrets:set EMAILJS_TEMPLATE_ID
firebase functions:secrets:set EMAILJS_PUBLIC_KEY
firebase functions:secrets:set EMAILJS_PRIVATE_KEY
```

### EmailJS template

1. Create/open your EmailJS email template.
2. Copy the HTML from `emailjs-template.html` into the template source editor.
3. Set **To Email** to:

```text
{{to_email}}
```

4. In the template **Attachments** tab add a **Variable Attachment**:
   - Parameter name: `qr_image`
   - Filename: `Aurelia-{{ticket_number}}.png`
   - Content type: PNG
5. The HTML uses `cid:qr_image`, so the generated ticket QR is embedded in the email.

Template parameters sent by the function:

```text
to_email
to_name
event_name
ticket_number
full_name
batch
class_name
id_number
qr_image
```

## Install

Requirements: Node.js 20+, npm, Firebase CLI.

```bash
npm install
cd functions
npm install
cd ..
```

Login to Firebase CLI if needed:

```bash
firebase login
```

The `.firebaserc` already points to:

```text
the-aurelia-2k26
```

## Local development

```bash
npm run dev
```

Camera scanning requires HTTPS or localhost.

## Deploy

```bash
npm run build
firebase deploy --only firestore:rules,functions,hosting
```

## First admin login

Sign in using **lankaknot@gmail.com**. `bootstrapAdmin` verifies the signed-in Google email and gives that Firebase user the `admin: true` custom claim. The function uses the Firebase Auth user record's existing custom claims so reserved token claims are never copied into custom claims.

After promotion the client refreshes its ID token automatically.

## Firestore structure

```text
users/{uid}
registrations/{uid}
paymentSlips/{slipId}
paymentSlips/{slipId}/chunks/{000..007}
tickets/{secureRandomToken}
ticketNumbers/{ticketNumber}
checkins/{autoId}
```

Example registration:

```js
{
  uid,
  email,
  fullName,
  batch: "OL2023" | "AL2026",
  className,
  idNumber,
  paymentAmount: 5500,
  paymentSlipId,
  paymentSlipBytes,
  paymentSlipChunks,
  paymentSlipMimeType,
  status: "pending" | "approved" | "rejected",
  ticketNumber,
  ticketToken,
  ticketUsed,
  createdAt,
  updatedAt
}
```

## Security design

- Admin authorization is based on Firebase **custom claims**, not a user-editable `admin` field.
- User registration approval/rejection and gate check-in happen in Cloud Functions using Firebase Admin SDK.
- Users cannot create ticket documents or mark tickets as used.
- Payment-slip chunks are readable only by the owner or an admin.
- Payment-slip chunks cannot be edited after creation.
- Ticket numbers are reserved in a dedicated document so duplicate numbers are rejected.
- Check-in uses a Firestore transaction, preventing two scanners from successfully using the same ticket concurrently.
- EmailJS Private Key remains a server secret.

## Before the event

Test these exact flows on real phones:

1. Standard user Google login.
2. O/L and A/L registrations.
3. Large bank slip photo compression and Firestore chunk upload.
4. Admin payment-slip viewer.
5. Approve with ticket number.
6. EmailJS ticket delivery and QR image rendering.
7. QR shown in user portal.
8. First scan = ENTRY APPROVED.
9. Second scan = ALREADY USED.
10. Two admin phones scanning the same QR nearly simultaneously.

## GitHub Pages
For GitHub Pages deployment, see **GITHUB-PAGES-SETUP.md**. The included GitHub Actions workflow builds the Vite app and deploys `dist/` automatically with the correct repository base path.
