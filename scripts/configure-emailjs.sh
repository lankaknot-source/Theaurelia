#!/usr/bin/env bash
set -euo pipefail

echo "The Aurelia 2K26 - EmailJS secret setup"
echo "Values are stored by Firebase Secret Manager and are not bundled into the website."
firebase functions:secrets:set EMAILJS_SERVICE_ID
firebase functions:secrets:set EMAILJS_TEMPLATE_ID
firebase functions:secrets:set EMAILJS_PUBLIC_KEY
firebase functions:secrets:set EMAILJS_PRIVATE_KEY

echo "EmailJS secrets saved. Deploy functions with: firebase deploy --only functions"
