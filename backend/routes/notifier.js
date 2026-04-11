const nodemailer = require('nodemailer');
const db = require('./db');

// ── Email transport ───────────────────────────────────────────────────
// Requires EMAIL_USER and EMAIL_PASS in your .env file.
// EMAIL_PASS must be a Gmail App Password (not your real password).
// Create one at: Google Account → Security → 2-Step Verification → App passwords
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// ── Internal helpers ──────────────────────────────────────────────────

function getUserById(id) {
  if (id == null) return null;
  return db.get('users').find({ id: Number(id) }).value() || null;
}

function nextNotifId() {
  const last = db.get('notifications').maxBy('id').value();
  return last ? last.id + 1 : 1;
}

// Save an in-app notification to lowdb
function saveNotification(userId, title, message, bookingId = null) {
  if (userId == null) return;
  db.get('notifications').push({
    id:        nextNotifId(),
    userId:    Number(userId),
    title,
    message,
    bookingId: bookingId || null,
    read:      false,
    createdAt: new Date().toISOString()
  }).write();
}

// Send email — fire-and-forget, never crashes a booking action
async function sendEmail(toEmail, subject, html) {
  if (!process.env.EMAIL_USER || !toEmail) return;
  try {
    await transporter.sendMail({
      from: `"PawPal" <${process.env.EMAIL_USER}>`,
      to:   toEmail,
      subject,
      html
    });
    console.log(`[PawPal] Email sent → ${toEmail}: ${subject}`);
  } catch (err) {
    console.error(`[PawPal] Email failed → ${toEmail}:`, err.message);
  }
}

// Branded email HTML wrapper
function emailTemplate(title, bodyHtml) {
  return `
    <div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;border:1px solid #e8d5b7;border-radius:12px;overflow:hidden">
      <div style="background:#3d2b1f;padding:18px 28px">
        <span style="color:white;font-size:20px;font-weight:700">PawPal</span>
        <span style="color:#e8d5b7;font-size:20px;margin-left:4px">🐾</span>
      </div>
      <div style="padding:28px 32px;background:#fffdf9">
        <h2 style="color:#3d2b1f;font-size:18px;margin:0 0 16px;font-family:Georgia,serif">${title}</h2>
        ${bodyHtml}
        <hr style="border:none;border-top:1px solid #e8d5b7;margin:24px 0 16px">
        <p style="color:#6b4c38;font-size:12px;margin:0">
          You received this because you have a PawPal account. Questions? Reply to this email.
        </p>
      </div>
    </div>`;
}

// Reusable booking detail table used in several emails
function bookingTable(booking) {
  return `
    <table style="border-collapse:collapse;margin:16px 0;width:100%">
      <tr>
        <td style="padding:8px 0;color:#6b4c38;font-size:13px;width:90px;vertical-align:top">Service</td>
        <td style="padding:8px 0;color:#3d2b1f;font-weight:600">${booking.service}</td>
      </tr>
      <tr>
        <td style="padding:8px 0;color:#6b4c38;font-size:13px;vertical-align:top">Date</td>
        <td style="padding:8px 0;color:#3d2b1f;font-weight:600">${booking.bookingDate} at ${booking.bookingTime}</td>
      </tr>
      <tr>
        <td style="padding:8px 0;color:#6b4c38;font-size:13px;vertical-align:top">Pet(s)</td>
        <td style="padding:8px 0;color:#3d2b1f;font-weight:600">${booking.petNames}</td>
      </tr>
      <tr>
        <td style="padding:8px 0;color:#6b4c38;font-size:13px;vertical-align:top">Price</td>
        <td style="padding:8px 0;color:#c4683a;font-weight:700">${booking.price}</td>
      </tr>
    </table>`;
}

// ── Notification events ───────────────────────────────────────────────

// 1. Owner creates a booking — notify minder of new request + confirm to owner
async function notifyBookingCreated(booking) {
  const owner  = getUserById(booking.ownerId);
  const minder = getUserById(booking.minderKey);

  // Tell the minder they have a new request
  if (minder) {
    saveNotification(
      minder.id,
      '🐾 New booking request',
      `${owner?.firstName || 'A pet owner'} requested ${booking.service} on ${booking.bookingDate}`,
      booking.id
    );
    await sendEmail(
      minder.email,
      'New PawPal Booking Request',
      emailTemplate('New booking request', `
        <p style="color:#3d2b1f">Hi ${minder.firstName},</p>
        <p style="color:#3d2b1f">
          <strong>${(owner?.firstName || '') + ' ' + (owner?.lastName || '')}</strong>
          has requested a booking with you.
        </p>
        ${bookingTable(booking)}
        <p style="color:#3d2b1f">Log in to PawPal to accept or decline this request.</p>
      `)
    );
  }

  // Confirm to the owner their request was sent
  if (owner) {
    saveNotification(
      owner.id,
      '📅 Booking request sent',
      `Your ${booking.service} request was sent to ${booking.minderName} for ${booking.bookingDate}`,
      booking.id
    );
    await sendEmail(
      owner.email,
      'PawPal Booking Request Sent',
      emailTemplate('Booking request sent', `
        <p style="color:#3d2b1f">Hi ${owner.firstName},</p>
        <p style="color:#3d2b1f">
          Your request has been sent to <strong>${booking.minderName}</strong>.
          You'll be notified as soon as they respond.
        </p>
        ${bookingTable(booking)}
      `)
    );
  }
}

// 2. Minder accepts — notify owner their booking is confirmed
async function notifyBookingAccepted(booking) {
  const owner  = getUserById(booking.ownerId);
  const minder = getUserById(booking.minderKey);

  if (owner) {
    saveNotification(
      owner.id,
      '✅ Booking confirmed!',
      `${booking.minderName} accepted your ${booking.service} on ${booking.bookingDate}`,
      booking.id
    );
    await sendEmail(
      owner.email,
      'Your PawPal Booking is Confirmed!',
      emailTemplate('Booking confirmed!', `
        <p style="color:#3d2b1f">Hi ${owner.firstName},</p>
        <p style="color:#3d2b1f">
          Great news — <strong>${booking.minderName}</strong> has confirmed your booking.
          Your pet is in safe hands. 🐾
        </p>
        ${bookingTable(booking)}
      `)
    );
  }

  // Also save an in-app notif for the minder so their own feed is consistent
  if (minder) {
    saveNotification(
      minder.id,
      '📅 Booking confirmed',
      `You confirmed ${booking.service} for ${owner?.firstName || 'a pet owner'} on ${booking.bookingDate}`,
      booking.id
    );
  }
}

// 3. Minder declines — notify owner
async function notifyBookingDeclined(booking) {
  const owner = getUserById(booking.ownerId);

  if (owner) {
    saveNotification(
      owner.id,
      '❌ Booking declined',
      `${booking.minderName} couldn't take your ${booking.service} on ${booking.bookingDate}`,
      booking.id
    );
    await sendEmail(
      owner.email,
      'PawPal Booking Update',
      emailTemplate('Booking declined', `
        <p style="color:#3d2b1f">Hi ${owner.firstName},</p>
        <p style="color:#3d2b1f">
          Unfortunately, <strong>${booking.minderName}</strong> wasn't able to accept your request.
        </p>
        ${bookingTable(booking)}
        <p style="color:#3d2b1f">
          Head back to PawPal to find another available minder for your pet.
        </p>
      `)
    );
  }
}

// 4. Owner cancels — notify the minder
async function notifyBookingCancelled(booking) {
  const owner  = getUserById(booking.ownerId);
  const minder = getUserById(booking.minderKey);

  if (minder) {
    saveNotification(
      minder.id,
      '🚫 Booking cancelled',
      `${owner?.firstName || 'A pet owner'} cancelled their ${booking.service} on ${booking.bookingDate}`,
      booking.id
    );
    await sendEmail(
      minder.email,
      'PawPal Booking Cancelled',
      emailTemplate('Booking cancelled', `
        <p style="color:#3d2b1f">Hi ${minder.firstName},</p>
        <p style="color:#3d2b1f">
          A booking has been cancelled by the pet owner.
        </p>
        ${bookingTable(booking)}
        <p style="color:#3d2b1f">Your calendar has been freed up for that slot.</p>
      `)
    );
  }
}

// 5. 24-hour reminder — called by the scheduler in server.js
async function notifyBookingReminder(booking) {
  const owner  = getUserById(booking.ownerId);
  const minder = getUserById(booking.minderKey);

  if (owner) {
    saveNotification(
      owner.id,
      '⏰ Booking reminder',
      `Your ${booking.service} with ${booking.minderName} is tomorrow at ${booking.bookingTime}`,
      booking.id
    );
    await sendEmail(
      owner.email,
      'PawPal Booking Reminder — Tomorrow',
      emailTemplate('Booking reminder', `
        <p style="color:#3d2b1f">Hi ${owner.firstName},</p>
        <p style="color:#3d2b1f">
          Just a reminder — you have a booking tomorrow with <strong>${booking.minderName}</strong>.
        </p>
        ${bookingTable(booking)}
      `)
    );
  }

  if (minder) {
    saveNotification(
      minder.id,
      '⏰ Booking reminder',
      `You have ${booking.service} for ${owner?.firstName || 'a pet owner'} tomorrow at ${booking.bookingTime}`,
      booking.id
    );
    await sendEmail(
      minder.email,
      'PawPal Booking Reminder — Tomorrow',
      emailTemplate('Booking reminder', `
        <p style="color:#3d2b1f">Hi ${minder.firstName},</p>
        <p style="color:#3d2b1f">
          Just a reminder — you have a booking tomorrow.
        </p>
        ${bookingTable(booking)}
      `)
    );
  }
}

module.exports = {
  saveNotification,
  notifyBookingCreated,
  notifyBookingAccepted,
  notifyBookingDeclined,
  notifyBookingCancelled,
  notifyBookingReminder
};