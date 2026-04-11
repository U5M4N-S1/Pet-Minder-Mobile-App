const express    = require('express');
const db         = require('../db');
const { requireAuth } = require('../middleware/authMiddleware');

const router = express.Router();
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function nextId() {
  const last = db.get('bookings').maxBy('id').value();
  return last ? last.id + 1 : 1;
}

function nextNotifId() {
  const last = db.get('notifications').maxBy('id').value();
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
    service:     b.service,
    petIds:      Array.isArray(b.petIds) ? b.petIds : []
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
  const { minderKey, minderName, minderAvatar, service, bookingDate, bookingTime, petNames, petIds, price } = req.body;
  const selectedPetIds = Array.isArray(petIds) ? petIds.map(String).filter(Boolean) : [];
  const selectedPetNames = String(petNames || '').split(/\s*&\s*/).map(n => n.trim().toLowerCase()).filter(Boolean);

  if (!minderKey || !service || !bookingDate || !bookingTime || !petNames) {
    return res.status(400).json({ error: 'minderKey, service, bookingDate, bookingTime, and petNames are required' });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(bookingDate)) {
    return res.status(400).json({ error: 'bookingDate must be YYYY-MM-DD' });
  }

  // Conflict 1: same pet already has a non-cancelled booking at this slot
  const petConflict = db.get('bookings')
    .filter(b => b.ownerId === req.user.userId
              && b.bookingDate === bookingDate
              && b.bookingTime === bookingTime
              && b.status !== 'cancelled'
              && b.status !== 'declined')
    .find(b => {
      const existingIds = Array.isArray(b.petIds) ? b.petIds.map(String) : [];
      if (existingIds.length && selectedPetIds.length) {
        return existingIds.some(id => selectedPetIds.includes(id));
      }
      const existingNames = String(b.petNames || '').split(/\s*&\s*/).map(n => n.trim().toLowerCase()).filter(Boolean);
      return selectedPetNames.some(name => existingNames.includes(name));
    })
    .value();

  if (petConflict) {
    return res.status(409).json({ error: 'One of your selected pets is already booked at that date/time' });
  }

  // Conflict 2: this minder already has an accepted (confirmed) booking at this slot
  const minderConflict = db.get('bookings')
    .find(b => String(b.minderKey) === String(minderKey)
            && b.bookingDate === bookingDate
            && b.bookingTime === bookingTime
            && b.status === 'confirmed')
    .value();

  if (minderConflict) {
    return res.status(409).json({ error: 'This minder is already booked at that date/time. Please choose another slot.' });
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
    petIds:       selectedPetIds,
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

// PATCH /api/bookings/:id — accept/decline (minder) or cancel (owner)
router.patch('/:id', requireAuth, (req, res) => {
  const id  = Number(req.params.id);
  const row = db.get('bookings').find({ id });
  const booking = row.value();
  if (!booking) return res.status(404).json({ error: 'Booking not found' });

  const { status } = req.body;
  const isMinder = Number(booking.minderKey) === req.user.userId;
  const isOwner  = booking.ownerId === req.user.userId;

  if (isMinder && ['confirmed', 'declined'].includes(status)) {
    row.assign({ status }).write();

    // Cascade: when a minder accepts a booking, auto-decline all other
    // pending requests for the same minder at the same date/time, and
    // notify each affected owner.
    if (status === 'confirmed') {
      const competing = db.get('bookings')
        .filter(b => b.id !== booking.id
                  && String(b.minderKey) === String(booking.minderKey)
                  && b.bookingDate === booking.bookingDate
                  && b.bookingTime === booking.bookingTime
                  && b.status === 'pending')
        .value();

      competing.forEach(c => {
        db.get('bookings').find({ id: c.id }).assign({ status: 'declined' }).write();
        const minderUser = db.get('users').find({ id: Number(booking.minderKey) }).value();
        const minderName = minderUser ? ((minderUser.firstName || '') + ' ' + (minderUser.lastName || '')).trim() : (booking.minderName || 'The minder');
        db.get('notifications').push({
          id:        nextNotifId(),
          userId:    c.ownerId,
          type:      'booking_declined',
          bookingId: c.id,
          title:     'Booking request declined',
          message:   minderName + ' selected another booking for ' + c.bookingDate + ' at ' + c.bookingTime + ', so your request for ' + c.petNames + ' was automatically declined.',
          read:      false,
          createdAt: new Date().toISOString()
        }).write();
      });
    }

    return res.json(toDTO(row.value()));
  }
  if (isOwner && status === 'cancelled') {
    row.assign({ status }).write();
    return res.json(toDTO(row.value()));
  }

  return res.status(403).json({ error: 'You do not have permission to update this booking' });
});

// GET /api/bookings/minder/:id/taken?date=YYYY-MM-DD
// Returns the list of bookingTime strings at which this minder is already
// confirmed for the given date. Used by the active-booking UI to grey out
// slots that this minder is no longer available in.
router.get('/minder/:id/taken', requireAuth, (req, res) => {
  const minderId = String(req.params.id);
  const date     = String(req.query.date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'date query param (YYYY-MM-DD) is required' });
  }
  const taken = db.get('bookings')
    .filter(b => String(b.minderKey) === minderId
              && b.bookingDate === date
              && b.status === 'confirmed')
    .map('bookingTime')
    .value();
  res.json({ minderId, date, taken });
});

module.exports = router;
