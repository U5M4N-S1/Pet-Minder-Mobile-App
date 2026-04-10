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

// GET /api/bookings/requests — bookings where the logged-in user is the minder
router.get('/requests', requireAuth, (req, res) => {
  const bookings = db.get('bookings')
    .filter(b => Number(b.minderKey) === req.user.userId)
    .sortBy('createdAt')
    .value()
    .reverse();                    // newest first
  // Attach pet-owner name so the minder knows who's requesting
  const enriched = bookings.map(b => {
    const owner = db.get('users').find({ id: b.ownerId }).value();
    const dto   = toDTO(b);
    dto.ownerName = owner ? ((owner.firstName || '') + ' ' + (owner.lastName || '')).trim() : 'Unknown';
    return dto;
  });
  res.json(enriched);
});

// PATCH /api/bookings/:id — accept or decline a booking (minder only)
router.patch('/:id', requireAuth, (req, res) => {
  const id  = Number(req.params.id);
  const row = db.get('bookings').find({ id });
  const booking = row.value();
  if (!booking) return res.status(404).json({ error: 'Booking not found' });

  // Only the assigned minder may update the booking
  if (Number(booking.minderKey) !== req.user.userId) {
    return res.status(403).json({ error: 'Only the assigned minder can update this booking' });
  }

  const { status } = req.body;
  if (!['confirmed', 'declined'].includes(status)) {
    return res.status(400).json({ error: 'Status must be "confirmed" or "declined"' });
  }

  row.assign({ status }).write();
  res.json(toDTO(row.value()));
});

module.exports = router;
