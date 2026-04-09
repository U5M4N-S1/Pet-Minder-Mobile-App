const express    = require('express');
const db         = require('../db');
const { requireAuth } = require('../middleware/authMiddleware');

const router = express.Router();
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function nextId() {
  const last = db.get('bookings').maxBy('id').value();
  return last ? last.id + 1 : 1;
}

function toDTO(b) {
  const d = new Date(b.bookingDate + 'T00:00:00');
  return {
    id:          b.id,
    minder:      b.minderKey,
    minderName:  b.minderName,
    avatar:      b.minderAvatar,
    day:         String(d.getDate()).padStart(2, '0'),
    month:       MONTHS[d.getMonth()],
    petEmoji:    b.petNames.toLowerCase().includes('luna') ? '🐈' : '🐕',
    petDetail:   b.petNames + ' · ' + b.service + ' · ' + b.bookingTime,
    price:       b.price,
    status:      b.status,
    bookingDate: b.bookingDate,
    bookingTime: b.bookingTime,
    service:     b.service
  };
}

// GET /api/bookings
router.get('/', requireAuth, (req, res) => {
  const bookings = db.get('bookings')
    .filter({ ownerId: req.user.userId })
    .sortBy('bookingDate')
    .value();
  res.json(bookings.map(toDTO));
});

// POST /api/bookings
router.post('/', requireAuth, (req, res) => {
  const { minderKey, minderName, minderAvatar, service, bookingDate, bookingTime, petNames, price } = req.body;

  if (!minderKey || !service || !bookingDate || !bookingTime || !petNames) {
    return res.status(400).json({ error: 'minderKey, service, bookingDate, bookingTime, and petNames are required' });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(bookingDate)) {
    return res.status(400).json({ error: 'bookingDate must be YYYY-MM-DD' });
  }

  const booking = {
    id:           nextId(),
    ownerId:      req.user.userId,
    minderKey:    minderKey,
    minderName:   minderName  || 'Minder',
    minderAvatar: minderAvatar || '🧑‍🦱',
    service,
    bookingDate,
    bookingTime,
    petNames,
    price:        price || '£15.00',
    status:       'pending',
    createdAt:    new Date().toISOString()
  };

  db.get('bookings').push(booking).write();
  res.status(201).json(toDTO(booking));
});

module.exports = router;
