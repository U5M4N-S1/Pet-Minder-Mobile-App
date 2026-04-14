const express = require('express');
const db      = require('../db');
const { requireAuth } = require('../middleware/authMiddleware');

const router = express.Router();

function pathIsValid(p) {
  return Array.isArray(p) && p.every(pt =>
    pt && typeof pt.lat === 'number' && typeof pt.lng === 'number' && typeof pt.t === 'number'
  );
}

// PUT /api/routes/:bookingId — upsert the recorded path for a booking
router.put('/:bookingId', requireAuth, (req, res) => {
  const bookingId = Number(req.params.bookingId);
  const booking = db.get('bookings').find({ id: bookingId }).value();
  if (!booking) return res.status(404).json({ error: 'Booking not found' });
  if (booking.ownerId !== req.user.userId &&
      String(booking.minderKey) !== String(req.user.userId)) {
    return res.status(403).json({ error: 'Not your booking' });
  }

  const { path, startCoord, endedAt } = req.body;
  if (!pathIsValid(path)) return res.status(400).json({ error: 'path must be [{lat,lng,t},...]' });
  if (!startCoord || typeof startCoord.lat !== 'number' || typeof startCoord.lng !== 'number') {
    return res.status(400).json({ error: 'startCoord {lat,lng} required' });
  }

  const existing = db.get('routes').find({ bookingId }).value();
  const record = {
    bookingId,
    ownerId:  booking.ownerId,
    minderKey: booking.minderKey,
    path,
    startCoord,
    endedAt:  endedAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  if (existing) {
    db.get('routes').find({ bookingId }).assign(record).write();
  } else {
    db.get('routes').push(record).write();
  }
  res.json(record);
});

// GET /api/routes/:bookingId — fetch one route
router.get('/:bookingId', requireAuth, (req, res) => {
  const bookingId = Number(req.params.bookingId);
  const route = db.get('routes').find({ bookingId }).value();
  if (!route) return res.status(404).json({ error: 'No route recorded' });
  const booking = db.get('bookings').find({ id: bookingId }).value();
  if (!booking || (booking.ownerId !== req.user.userId &&
      String(booking.minderKey) !== String(req.user.userId))) {
    return res.status(403).json({ error: 'Not your booking' });
  }
  res.json(route);
});

// GET /api/routes — list routes for bookings the user is part of
router.get('/', requireAuth, (req, res) => {
  const uid = req.user.userId;
  const mine = db.get('routes')
    .filter(r => r.ownerId === uid || String(r.minderKey) === String(uid))
    .value();
  res.json(mine);
});

module.exports = router;
