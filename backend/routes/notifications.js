const express = require('express');
const db      = require('../db');
const { requireAuth } = require('../middleware/authMiddleware');

const router = express.Router();

function nextNotifId() {
  const last = db.get('notifications').maxBy('id').value();
  return last ? last.id + 1 : 1;
}

// Generate booking reminders for the given user. Called lazily on every
// GET /notifications so reminders appear without a background scheduler.
// A reminder is created once per booking (tracked by a unique key) when the
// booking is confirmed and its date/time is within the next 24 hours.
function generateReminders(userId) {
  const now = new Date();
  const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  // Find confirmed bookings where this user is the owner
  const bookings = db.get('bookings')
    .filter(b => b.ownerId === userId && b.status === 'confirmed')
    .value();

  bookings.forEach(b => {
    // Build a Date from bookingDate + bookingTime
    const dt = new Date(b.bookingDate + 'T' + b.bookingTime + ':00');
    if (isNaN(dt.getTime())) return;
    // Only create reminders for bookings within the next 24 hours (and not in the past)
    if (dt <= now || dt > in24h) return;

    // Check if a reminder already exists for this booking + user
    const exists = db.get('notifications')
      .find({ userId, type: 'booking_reminder', bookingId: b.id })
      .value();
    if (exists) return;

    // Resolve minder name
    let minderName = b.minderName || 'your minder';
    if (b.minderKey != null) {
      const mu = db.get('users').find({ id: Number(b.minderKey) }).value();
      if (mu) minderName = ((mu.firstName || '') + ' ' + (mu.lastName || '')).trim() || minderName;
    }

    db.get('notifications').push({
      id:        nextNotifId(),
      userId,
      type:      'booking_reminder',
      bookingId: b.id,
      title:     'Upcoming booking reminder',
      message:   'Your booking with ' + minderName + ' for ' + b.petNames + ' is coming up on ' + b.bookingDate + ' at ' + b.bookingTime + '.',
      read:      false,
      createdAt: new Date().toISOString()
    }).write();
  });
}

// GET /api/notifications — list notifications for the logged-in user, newest first
router.get('/', requireAuth, (req, res) => {
  // Generate any pending reminders before returning the list
  generateReminders(req.user.userId);

  const list = db.get('notifications')
    .filter({ userId: req.user.userId })
    .sortBy('createdAt')
    .value()
    .reverse();
  res.json(list);
});

// PATCH /api/notifications/:id — mark as read
router.patch('/:id', requireAuth, (req, res) => {
  const id  = Number(req.params.id);
  const row = db.get('notifications').find({ id });
  const n   = row.value();
  if (!n) return res.status(404).json({ error: 'Notification not found' });
  if (n.userId !== req.user.userId) return res.status(403).json({ error: 'Not your notification' });
  row.assign({ read: true }).write();
  res.json(row.value());
});

// DELETE /api/notifications/:id
router.delete('/:id', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const n  = db.get('notifications').find({ id }).value();
  if (!n) return res.status(404).json({ error: 'Notification not found' });
  if (n.userId !== req.user.userId) return res.status(403).json({ error: 'Not your notification' });
  db.get('notifications').remove({ id }).write();
  res.status(204).end();
});

module.exports = router;
