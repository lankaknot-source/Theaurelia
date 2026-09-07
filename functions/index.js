import crypto from 'node:crypto';
import QRCode from 'qrcode';
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';

initializeApp();
const db = getFirestore();
const auth = getAuth();
const REGION = 'asia-south1';
const PRIMARY_ADMIN_EMAIL = 'lankaknot@gmail.com';

const EMAILJS_SERVICE_ID = defineSecret('EMAILJS_SERVICE_ID');
const EMAILJS_TEMPLATE_ID = defineSecret('EMAILJS_TEMPLATE_ID');
const EMAILJS_PUBLIC_KEY = defineSecret('EMAILJS_PUBLIC_KEY');
const EMAILJS_PRIVATE_KEY = defineSecret('EMAILJS_PRIVATE_KEY');
const emailSecrets = [EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, EMAILJS_PUBLIC_KEY, EMAILJS_PRIVATE_KEY];

function requireAuth(request) {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Please sign in first.');
  return request.auth;
}

function requireAdmin(request) {
  const user = requireAuth(request);
  const email = String(user.token.email || '').trim().toLowerCase();
  const isPrimaryAdmin = email === PRIMARY_ADMIN_EMAIL && user.token.email_verified === true;
  if (user.token.admin !== true && !isPrimaryAdmin) {
    throw new HttpsError('permission-denied', 'Admin access required.');
  }
  return user;
}

function cleanTicketNumber(value) {
  const v = String(value || '').trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9\-_/]{1,29}$/.test(v)) {
    throw new HttpsError('invalid-argument', 'Ticket number must be 2-30 characters using letters, numbers, -, _ or /.');
  }
  return v;
}

function batchLabel(batch) {
  return batch === 'OL2023' ? '2023 O/L Batch' : batch === 'AL2026' ? '2026 A/L Batch' : String(batch || '');
}

export const bootstrapAdmin = onCall({ region: REGION }, async (request) => {
  const current = requireAuth(request);
  const email = String(current.token.email || '').toLowerCase();
  if (email !== PRIMARY_ADMIN_EMAIL || current.token.email_verified !== true) return { promoted: false };
  if (current.token.admin === true) {
    await db.doc(`users/${current.uid}`).set({ admin: true }, { merge: true });
    return { promoted: false, alreadyAdmin: true };
  }
  const userRecord = await auth.getUser(current.uid);
  await auth.setCustomUserClaims(current.uid, { ...(userRecord.customClaims || {}), admin: true });
  await db.doc(`users/${current.uid}`).set({ admin: true, adminUpdatedAt: FieldValue.serverTimestamp() }, { merge: true });
  return { promoted: true };
});

export const setUserAdmin = onCall({ region: REGION }, async (request) => {
  requireAdmin(request);
  const uid = String(request.data?.uid || '').trim();
  const makeAdmin = request.data?.admin === true;
  if (!uid) throw new HttpsError('invalid-argument', 'User UID is required.');
  const target = await auth.getUser(uid);
  if (String(target.email || '').toLowerCase() === PRIMARY_ADMIN_EMAIL && !makeAdmin) {
    throw new HttpsError('failed-precondition', 'The primary admin cannot be demoted.');
  }
  const currentClaims = target.customClaims || {};
  await auth.setCustomUserClaims(uid, { ...currentClaims, admin: makeAdmin });
  await db.doc(`users/${uid}`).set({ admin: makeAdmin, adminUpdatedAt: FieldValue.serverTimestamp() }, { merge: true });
  return { ok: true, uid, admin: makeAdmin };
});

export const approveRegistration = onCall({ region: REGION, secrets: emailSecrets, timeoutSeconds: 60 }, async (request) => {
  const admin = requireAdmin(request);
  const uid = String(request.data?.uid || '').trim();
  const ticketNumber = cleanTicketNumber(request.data?.ticketNumber);
  if (!uid) throw new HttpsError('invalid-argument', 'Registration UID is required.');

  const registrationRef = db.doc(`registrations/${uid}`);
  const ticketNumberRef = db.doc(`ticketNumbers/${ticketNumber}`);
  const token = crypto.randomBytes(32).toString('base64url');
  const ticketRef = db.doc(`tickets/${token}`);

  let registrationData;
  await db.runTransaction(async (tx) => {
    const [regSnap, numSnap] = await Promise.all([tx.get(registrationRef), tx.get(ticketNumberRef)]);
    if (!regSnap.exists) throw new HttpsError('not-found', 'Registration not found.');
    registrationData = regSnap.data();
    if (registrationData.status !== 'pending') throw new HttpsError('failed-precondition', 'Only pending registrations can be approved.');
    if (numSnap.exists) throw new HttpsError('already-exists', 'That ticket number is already in use.');

    tx.create(ticketNumberRef, { token, uid, createdAt: FieldValue.serverTimestamp() });
    tx.create(ticketRef, {
      token,
      ticketNumber,
      uid,
      email: registrationData.email,
      fullName: registrationData.fullName,
      batch: registrationData.batch,
      className: registrationData.className,
      idNumber: registrationData.idNumber,
      used: false,
      usedAt: null,
      usedBy: null,
      createdAt: FieldValue.serverTimestamp(),
      approvedBy: admin.uid,
    });
    tx.update(registrationRef, {
      status: 'approved',
      ticketNumber,
      ticketToken: token,
      approvedAt: FieldValue.serverTimestamp(),
      approvedBy: admin.uid,
      ticketUsed: false,
      updatedAt: FieldValue.serverTimestamp(),
      rejectionReason: null,
    });
  });

  try {
    await sendTicketEmail({ ...registrationData, ticketNumber, token });
    await registrationRef.set({ emailStatus: 'sent', emailSentAt: FieldValue.serverTimestamp(), emailError: null }, { merge: true });
  } catch (error) {
    console.error('EmailJS send failed:', error);
    await registrationRef.set({ emailStatus: 'failed', emailError: String(error.message || error).slice(0, 500) }, { merge: true });
  }

  return { ok: true, ticketNumber, token };
});

export const rejectRegistration = onCall({ region: REGION }, async (request) => {
  const admin = requireAdmin(request);
  const uid = String(request.data?.uid || '').trim();
  const reason = String(request.data?.reason || '').trim().slice(0, 500);
  if (!uid || !reason) throw new HttpsError('invalid-argument', 'UID and rejection reason are required.');
  const ref = db.doc(`registrations/${uid}`);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Registration not found.');
  if (snap.data().status !== 'pending') throw new HttpsError('failed-precondition', 'Only pending registrations can be rejected.');
  await ref.update({ status: 'rejected', rejectionReason: reason, rejectedAt: FieldValue.serverTimestamp(), rejectedBy: admin.uid, updatedAt: FieldValue.serverTimestamp() });
  return { ok: true };
});

export const resendTicketEmail = onCall({ region: REGION, secrets: emailSecrets, timeoutSeconds: 60 }, async (request) => {
  requireAdmin(request);
  const uid = String(request.data?.uid || '').trim();
  const regSnap = await db.doc(`registrations/${uid}`).get();
  if (!regSnap.exists) throw new HttpsError('not-found', 'Registration not found.');
  const reg = regSnap.data();
  if (reg.status !== 'approved' || !reg.ticketToken) throw new HttpsError('failed-precondition', 'Ticket is not approved.');
  await sendTicketEmail({ ...reg, token: reg.ticketToken });
  await regSnap.ref.set({ emailStatus: 'sent', emailSentAt: FieldValue.serverTimestamp(), emailError: null }, { merge: true });
  return { ok: true };
});

async function sendTicketEmail(reg) {
  const qrPayload = `AURELIA2K26:${reg.token}`;
  const qrBuffer = await QRCode.toBuffer(qrPayload, {
    type: 'png',
    width: 900,
    margin: 2,
    errorCorrectionLevel: 'H',
  });
  const qrDataUri = `data:image/png;base64,${qrBuffer.toString('base64')}`;

  const payload = {
    service_id: EMAILJS_SERVICE_ID.value(),
    template_id: EMAILJS_TEMPLATE_ID.value(),
    user_id: EMAILJS_PUBLIC_KEY.value(),
    accessToken: EMAILJS_PRIVATE_KEY.value(),
    template_params: {
      to_email: reg.email,
      to_name: reg.fullName,
      event_name: 'The Aurelia 2K26',
      ticket_number: reg.ticketNumber,
      full_name: reg.fullName,
      batch: batchLabel(reg.batch),
      class_name: reg.className,
      id_number: reg.idNumber,
      qr_image: qrDataUri,
    },
  };

  const response = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(`EmailJS ${response.status}: ${await response.text()}`);
  return true;
}

export const checkInTicket = onCall({ region: REGION }, async (request) => {
  const admin = requireAdmin(request);
  const token = String(request.data?.token || '').trim();
  if (!/^[A-Za-z0-9_-]{40,60}$/.test(token)) throw new HttpsError('invalid-argument', 'Invalid ticket token.');

  const ticketRef = db.doc(`tickets/${token}`);
  const checkinRef = db.collection('checkins').doc();
  let result;

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ticketRef);
    if (!snap.exists) throw new HttpsError('not-found', 'Ticket not found.');
    const ticket = snap.data();
    if (ticket.used === true) {
      result = { status: 'already_used', ...publicTicket(ticket), usedAt: ticket.usedAt || null };
      return;
    }

    const now = FieldValue.serverTimestamp();
    tx.update(ticketRef, { used: true, usedAt: now, usedBy: admin.uid });
    tx.set(checkinRef, { token, ticketNumber: ticket.ticketNumber, uid: ticket.uid, checkedInBy: admin.uid, checkedInAt: now });
    tx.set(db.doc(`registrations/${ticket.uid}`), { ticketUsed: true, ticketUsedAt: now, updatedAt: now }, { merge: true });
    result = { status: 'checked_in', ...publicTicket(ticket) };
  });

  if (result?.status === 'already_used' && result.usedAt?.toDate) {
    result.usedAtText = result.usedAt.toDate().toLocaleString('en-LK', { timeZone: 'Asia/Colombo' });
  }
  return result;
});

function publicTicket(ticket) {
  return {
    ticketNumber: ticket.ticketNumber,
    fullName: ticket.fullName,
    batchLabel: batchLabel(ticket.batch),
    className: ticket.className,
    idNumber: ticket.idNumber,
  };
}
