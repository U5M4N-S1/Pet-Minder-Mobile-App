const nodemailer = require('nodemailer');
const db = require('./db');

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,      // pawpal.notifications@gmail.com
    pass: process.env.EMAIL_PASS       // Gmail App Password (not your real password)
  }
});

function getUserById(id) {
  return db.get('users').find({ id }).value();
}

function nextNotifId() {
  const last = db.get('notifications').maxBy('id').value();
  return last ? last.id + 1 : 1;
}

// Save an in-app notification to the database
function saveNotification(userId, title, message, bookingId = null) {
  const notif = {
    id: nextNotifId(),
    userId,
    title,
    message,
    bookingId,
    read: false,
    createdAt: new Date().toISOString()
  };
  db.get('notifications').push(notif).write();
}

// Send an email (fire-and-forget — won't crash the booking if email fails)
async function sendEmail(toEmail, subject, html) {
  if (!process.env.EMAIL_USER) return; // skip if not configured
  try {
    await transporter.sendMail({
      from: `"PawPal 🐾" <${process.env.EMAIL_USER}>`,
      to: toEmail,
      subject,
      html
    });
  } catch (err) {
    console.error('[PawPal Email] Failed:', err.message);
  }
}

// ── The four notification events ──────────────────────────────────

async function notifyBookingCreated(booking) {
  const owner  = getUserById(booking.ownerId);
  const minder = getUserById(Number(booking.minderKey));

  // In-app: tell the minder they have a new request
  if (minder) {
    saveNotification(minder.id,
      '🐾 New booking request',
      `${owner?.firstName || 'A pet owner'} wants to book you for ${booking.service} on ${booking.bookingDate}`,
      booking.id
    );
    await sendEmail(minder.email,
      '🐾 New PawPal Booking Request',
      emailTemplate('New Booking Request', `
        <p>Hi ${minder.firstName},</p>
        <p><strong>${owner?.firstName} ${owner?.lastName}</strong> has requested a booking with you.</p>
        <p><strong>Service:</strong> ${booking.service}<br>
           <strong>Date:</strong> ${booking.bookingDate} at ${booking.bookingTime}<br>
           <strong>Pet(s):</strong> ${booking.petNames}</p>
        <p>Log in to PawPal to accept or decline.</p>
      `)
    );
  }

  // In-app: confirm to the owner their request was sent
  if (owner) {
    saveNotification(owner.id,
      '📅 Booking request sent',
      `Your booking for ${booking.service} on ${booking.bookingDate} has been sent to ${booking.minderName}`,
      booking.id
    );
    await sendEmail(owner.email,
      '📅 PawPal Booking Request Sent',
      emailTemplate('Booking Request Sent', `
        <p>Hi ${owner.firstName},</p>
        <p>Your booking request has been sent to <strong>${booking.minderName}</strong>.</p>
        <p><strong>Service:</strong> ${booking.service}<br>
           <strong>Date:</strong> ${booking.bookingDate} at ${booking.bookingTime}<br>
           <strong>Pet(s):</strong> ${booking.petNames}</p>
        <p>You'll be notified once they accept or decline.</p>
      `)
    );
  }
}

async function notifyBookingAccepted(booking) {
  const owner = getUserById(booking.ownerId);
  const minder = getUserById(Number(booking.minderKey));

  if (owner) {
    saveNotification(owner.id,
      '✅ Booking confirmed!',
      `${booking.minderName} accepted your ${booking.service} on ${booking.bookingDate}`,
      booking.id
    );
    await sendEmail(owner.email,
      '✅ PawPal Booking Confirmed!',
      emailTemplate('Booking Confirmed', `
        <p>Hi ${owner.firstName},</p>
        <p>Great news! <strong>${booking.minderName}</strong> has confirmed your booking.</p>
        <p><strong>Service:</strong> ${booking.service}<br>
           <strong>Date:</strong> ${booking.bookingDate} at ${booking.bookingTime}<br>
           <strong>Pet(s):</strong> ${booking.petNames}</p>
        <p>Your pet is in safe hands. 🐾</p>
      `)
    );
  }

  if (minder) {
    saveNotification(minder.id,
      '📅 Booking confirmed',
      `You confirmed ${booking.service} for ${owner?.firstName || 'a pet owner'} on ${booking.bookingDate}`,
      booking.id
    );
  }
}

async function notifyBookingDeclined(booking) {
  const owner = getUserById(booking.ownerId);

  if (owner) {
    saveNotification(owner.id,
      '❌ Booking declined',
      `${booking.minderName} couldn't take your ${booking.service} on ${booking.bookingDate}`,
      booking.id
    );
    await sendEmail(owner.email,
      '❌ PawPal Booking Update',
      emailTemplate('Booking Declined', `
        <p>Hi ${owner.firstName},</p>
        <p>Unfortunately, <strong>${booking.minderName}</strong> wasn't able to accept your request.</p>
        <p>Head back to PawPal to find another available minder.</p>
      `)
    );
  }
}

async function notifyBookingCancelled(booking) {
  const minder = getUserById(Number(booking.minderKey));

  if (minder) {
    const owner = getUserById(booking.ownerId);
    saveNotification(minder.id,
      '🚫 Booking cancelled',
      `${owner?.firstName || 'A pet owner'} cancelled their ${booking.service} on ${booking.bookingDate}`,
      booking.id
    );
    await sendEmail(minder.email,
      '🚫 PawPal Booking Cancelled',
      emailTemplate('Booking Cancelled', `
        <p>Hi ${minder.firstName},</p>
        <p>A booking has been cancelled by the pet owner.</p>
        <p><strong>Service:</strong> ${booking.service}<br>
           <strong>Date:</strong> ${booking.bookingDate}</p>
      `)
    );
  }
}

// Shared email HTML wrapper
function emailTemplate(title, body) {
  return `
    <div style="font-family:sans-serif;max-width:520px;margin:auto;border:1px solid #e8d5b7;border-radius:12px;overflow:hidden">
      <div style="background:#3d2b1f;padding:20px 28px">
        <span style="color:white;font-size:20px;font-weight:700">🐾 PawPal</span>
      </div>
      <div style="padding:28px;background:#fffdf9">
        <h2 style="color:#3d2b1f;font-size:18px;margin:0 0 16px">${title}</h2>
        ${body}
        <hr style="border:none;border-top:1px solid #e8d5b7;margin:24px 0">
        <p style="color:#6b4c38;font-size:12px">You received this because you have an account on PawPal.</p>
      </div>
    </div>`;
}

module.exports = { notifyBookingCreated, notifyBookingAccepted, notifyBookingDeclined, notifyBookingCancelled, saveNotification };