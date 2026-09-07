# The Aurelia 2K26 — GitHub Pages setup

This version can run directly from GitHub Pages without Vite bundling. Browser import maps resolve Firebase, QRCode, html5-qrcode and Three.js from pinned CDN module URLs.

## Recommended: GitHub Actions
1. Upload the entire project to the repository root, including the hidden `.github` folder.
2. Open GitHub repository → Settings → Pages.
3. Set **Source** to **GitHub Actions**.
4. Open Actions and run **Deploy The Aurelia 2K26 to GitHub Pages**, or push a new commit.
5. Wait until both the workflow and Pages deployment are green.

## Fallback: Deploy from branch
This source also works without a build.
1. Settings → Pages.
2. Source: **Deploy from a branch**.
3. Branch: `main` (or `master`) and folder: `/ (root)`.
4. Save.

## Firebase Google login
Firebase Console → Authentication → Settings → Authorized domains:
- add `lankaknot-source.github.io`

## Firebase backend
GitHub Pages only hosts the frontend. Firestore rules and Cloud Functions still need Firebase deployment from a local terminal:

```bash
firebase login
firebase deploy --only firestore:rules,firestore:indexes,functions
```

## EmailJS
Keep the EmailJS private key out of browser code. Configure it as a Firebase Functions secret using `scripts/configure-emailjs.sh`.

## How to recognize the old broken deployment
If DevTools shows:

`Failed to resolve module specifier "qrcode"`

the browser is still receiving the old source without this project's import map. Replace the repository files with this version and redeploy/refresh the Pages deployment.
