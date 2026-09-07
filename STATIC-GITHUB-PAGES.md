# The Aurelia 2K26 — Direct GitHub Pages Deployment

This build is intentionally runnable directly from the repository root. It does **not** depend on npm, Vite, an import map, or a dist folder for the frontend.

## GitHub Pages

1. Upload/replace all files from this package in the repository root.
2. GitHub → Settings → Pages.
3. Source: **Deploy from a branch**.
4. Branch: **main**.
5. Folder: **/ (root)**.
6. Save and wait for Pages deployment.
7. Open the site in an Incognito window or hard refresh (`Ctrl+Shift+R`).

The frontend imports qrcode, html5-qrcode, Three.js and Firebase with complete HTTPS URLs. There are no bare browser module imports such as `from "qrcode"`.

## Firebase Google login

Firebase Console → Authentication → Settings → Authorized domains: add:

`lankaknot-source.github.io`

## Backend

Cloud Functions and Firestore rules still need Firebase CLI deployment from this project.
