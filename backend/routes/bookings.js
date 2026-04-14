const express    = require('express');
const db         = require('../db');
const { requireAuth } = require('../middleware/authMiddleware');
const { validateBookingSlot, normalizeAvailability } = require('../lib/availability');

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

// Booking duration in minutes — used for end-time + auto-completion.
const BOOKING_DURATION_MIN = 60;

function bookingEndTime(b) {
  if (!b || !b.bookingDate || !b.bookingTime) return null;
  const start = new Date(b.bookingDate + 'T' + b.bookingTime + ':00');
  if (isNaN(start.getTime())) return null;
  return new Date(start.getTime() + BOOKING_DURATION_MIN * 60 * 1000);
}

// Sweep: any confirmed booking whose end-time has passed becomes
// `completed` and its authorised payment is captured. Called lazily on
// every read so state survives a page refresh without a background worker.
function sweepCompletions() {
  const now = Date.now();
  const confirmed = db.get('bookings').filter({ status: 'confirmed' }).value();
  confirmed.forEach(b => {
    const end = bookingEndTime(b);
    if (!end || end.getTime() > now) return;
    const updates = { status: 'completed' };
    if (b.payment && b.payment.status === 'authorised') {
      updates.payment = Object.assign({}, b.payment, {
        status:     'captured',
        capturedAt: new Date().toISOString()
      });
    }
    db.get('bookings').find({ id: b.id }).assign(updates).write();
  });
}

function toDTO(b) {
  const d = new Date(b.bookingDate + 'T00:00:00');
  // Re-hydrate the minder's live name + profile image from the users
  // table so the booking card always shows the current picture even if
  // the minder updated it after the booking was created.
  let liveName  = b.minderName;
  let liveImage = b.minderImage || '';
  if (b.minderKey != null) {
    const mu = db.get('users').find({ id: Number(b.minderKey) }).value();
    if (mu) {
      liveName  = ((mu.firstName || '') + ' ' + (mu.lastName || '')).trim() || liveName;
      liveImage = mu.profileImage || liveImage;
    }
  }
  return {
    id:          b.id,
    minder:      b.minderKey,
    minderName:  liveName,
    minderImage: liveImage,
    avatar:      b.minderAvatar || '🧑‍🦱',
    day:         String(d.getDate()).padStart(2, '0'),
    month:       MONTHS[d.getMonth()],
    petEmoji:    b.petNames.toLowerCase().includes('luna') ? '🐈' : '🐕',
    petDetail:   b.petNames + ' · ' + b.service + ' · ' + b.bookingTime,
    price:       b.price,
    status:      b.status,
    bookingDate: b.bookingDate,
    bookingTime: b.bookingTime,
    service:     b.service,
    petIds:      Array.isArray(b.petIds) ? b.petIds : [],
    payment:     b.payment || null
  };
}

// GET /api/bookings
router.get('/', requireAuth, (req, res) => {
  sweepCompletions();
  const bookings = db.get('bookings')
    .filter({ ownerId: req.user.userId })
    .sortBy('bookingDate')
    .value();
  res.json(bookings.map(toDTO));
});

// POST /api/bookings
router.post('/', requireAuth, (req, res) => {
  const { minderKey, minderName, minderAvatar, minderImage, service, bookingDate, bookingTime, petNames, petIds, price, payment } = req.body;
  const selectedPetIds = Array.isArray(petIds) ? petIds.map(String).filter(Boolean) : [];
  const selectedPetNames = String(petNames || '').split(/\s*&\s*/).map(n => n.trim().toLowerCase()).filter(Boolean);

  if (!minderKey || !service || !bookingDate || !bookingTime || !petNames) {
    return res.status(400).json({ error: 'minderKey, service, bookingDate, bookingTime, and petNames are required' });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(bookingDate)) {
    return res.status(400).json({ error: 'bookingDate must be YYYY-MM-DD' });
  }

  // Availability check — enforced for any booking targeting a real minder
  // account. Legacy demo minders (non-numeric keys like 'sarah') are not in
  // the users table and have no availability data, so we skip them to keep
  // the seeded demo flow working. Real numeric ids must validate.
  if (minderKey != null && /^\d+$/.test(String(minderKey))) {
    const minderUser = db.get('users').find({ id: Number(minderKey) }).value();
    if (!minderUser || minderUser.role !== 'minder') {
      return res.status(404).json({ error: 'Minder not found' });
    }
    const check = validateBookingSlot(minderUser, bookingDate, bookingTime);
    if (!check.ok) {
      return res.status(409).json({ error: check.error });
    }
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

  // Resolve the authoritative minder info from the users table when the
  // minderKey points at a real account, so the stored booking always uses
  // the correct name + profile image regardless of what the client sent.
  let resolvedName  = minderName  || 'Minder';
  let resolvedImage = minderImage || '';
  if (minderKey != null && /^\d+$/.test(String(minderKey))) {
    const mu = db.get('users').find({ id: Number(minderKey) }).value();
    if (mu) {
      resolvedName  = ((mu.firstName || '') + ' ' + (mu.lastName || '')).trim() || resolvedName;
      resolvedImage = mu.profileImage || resolvedImage;
    }
  }

  // Normalise the demo payment record. We only persist the safe/display
  // bits (never raw PAN/CVV) and force the status to `authorised` — the
  // server is the source of truth for payment state. If no payment block
  // was supplied (legacy demo flow), leave it null.
  let paymentRecord = null;
  if (payment && typeof payment === 'object') {
    paymentRecord = {
      method:         String(payment.method || 'card'),
      cardholderName: String(payment.cardholderName || '').slice(0, 80),
      last4:          String(payment.last4 || '').replace(/\D/g, '').slice(-4),
      expiry:         String(payment.expiry || '').slice(0, 5),
      postcode:       String(payment.postcode || '').slice(0, 8),
      transactionId:  String(payment.transactionId || ('txn_' + Date.now().toString(36))),
      amount:         payment.amount || price || '£15.00',
      status:         'authorised',
      authorisedAt:   new Date().toISOString()
    };
  }

  const booking = {
    id:           nextId(),
    ownerId:      req.user.userId,
    minderKey:    minderKey,
    minderName:   resolvedName,
    minderAvatar: minderAvatar || '🧑‍🦱',
    minderImage:  resolvedImage,
    service,
    bookingDate,
    bookingTime,
    petNames,
    petIds:       selectedPetIds,
    price:        price || '£15.00',
    status:       'pending',
    payment:      paymentRecord,
    createdAt:    new Date().toISOString()
  };

  db.get('bookings').push(booking).write();

  // Notify the minder about the new booking request
  if (minderKey != null && /^\d+$/.test(String(minderKey))) {
    const owner = db.get('users').find({ id: req.user.userId }).value();
    const ownerName = owner ? ((owner.firstName || '') + ' ' + (owner.lastName || '')).trim() : 'A customer';
    db.get('notifications').push({
      id:        nextNotifId(),
      userId:    Number(minderKey),
      type:      'booking_request',
      bookingId: booking.id,
      title:     'New booking request',
      message:   ownerName + ' wants to book ' + service + ' for ' + petNames + ' on ' + bookingDate + ' at ' + bookingTime + '.',
      read:      false,
      createdAt: new Date().toISOString()
    }).write();
  }

  res.status(201).json(toDTO(booking));
});

// GET /api/bookings/requests — bookings where the logged-in user is the minder
router.get('/requests', requireAuth, (req, res) => {
  sweepCompletions();
  const bookings = db.get('bookings')
    .filter(b => Number(b.minderKey) === req.user.userId)
    .sortBy('createdAt')
    .value()
    .reverse();                    // newest first
  // Attach pet-owner name + id so the minder knows who's requesting
  // and can reference them in the reporting flow.
  const enriched = bookings.map(b => {
    const owner = db.get('users').find({ id: b.ownerId }).value();
    const dto   = toDTO(b);
    dto.ownerId   = b.ownerId;
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
    const patch = { status };
    // Declined bookings void the authorised payment — nothing is ever
    // captured. Confirmed bookings leave the payment in `authorised`
    // state; capture happens at end-time via sweepCompletions().
    if (status === 'declined' && booking.payment && booking.payment.status === 'authorised') {
      patch.payment = Object.assign({}, booking.payment, { status: 'void', voidedAt: new Date().toISOString() });
    }
    row.assign(patch).write();

    let chatId = null;
    if (status === 'confirmed') {
      const { findOrCreateChat } = require('./chats');
      const chat = findOrCreateChat(booking.ownerId, Number(booking.minderKey));
      if (chat) chatId = chat.id;
    }

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
        const cascadePatch = { status: 'declined' };
        if (c.payment && c.payment.status === 'authorised') {
          cascadePatch.payment = Object.assign({}, c.payment, { status: 'void', voidedAt: new Date().toISOString() });
        }
        db.get('bookings').find({ id: c.id }).assign(cascadePatch).write();
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

    // Notify the owner about the accept/decline decision
    const minderUser = db.get('users').find({ id: Number(booking.minderKey) }).value();
    const minderFullName = minderUser ? ((minderUser.firstName || '') + ' ' + (minderUser.lastName || '')).trim() : (booking.minderName || 'The minder');
    const ownerUser = db.get('users').find({ id: booking.ownerId }).value();
    const ownerFullName = ownerUser ? ((ownerUser.firstName || '') + ' ' + (ownerUser.lastName || '')).trim() : 'The customer';

    if (status === 'confirmed') {
      // Notify the owner their booking was confirmed
      db.get('notifications').push({
        id:        nextNotifId(),
        userId:    booking.ownerId,
        type:      'booking_confirmed',
        bookingId: booking.id,
        title:     'Booking confirmed!',
        message:   minderFullName + ' accepted your booking for ' + booking.petNames + ' on ' + booking.bookingDate + ' at ' + booking.bookingTime + '.',
        read:      false,
        createdAt: new Date().toISOString()
      }).write();
      // Notify the minder as confirmation receipt
      db.get('notifications').push({
        id:        nextNotifId(),
        userId:    Number(booking.minderKey),
        type:      'booking_confirmed',
        bookingId: booking.id,
        title:     'Booking confirmed',
        message:   'You confirmed the booking for ' + ownerFullName + '\'s ' + booking.petNames + ' on ' + booking.bookingDate + ' at ' + booking.bookingTime + '.',
        read:      false,
        createdAt: new Date().toISOString()
      }).write();
    } else if (status === 'declined') {
      db.get('notifications').push({
        id:        nextNotifId(),
        userId:    booking.ownerId,
        type:      'booking_declined',
        bookingId: booking.id,
        title:     'Booking declined',
        message:   minderFullName + ' declined your booking for ' + booking.petNames + ' on ' + booking.bookingDate + ' at ' + booking.bookingTime + '.',
        read:      false,
        createdAt: new Date().toISOString()
      }).write();
    }

    const dto = toDTO(row.value());
    if (chatId) dto.chatId = chatId;
    return res.json(dto);
  }
  if (isOwner && status === 'cancelled') {
    // Cancelling before completion must void any authorised payment.
    // Already-captured (completed) payments cannot be cancelled.
    const patch = { status };
    if (booking.payment && booking.payment.status === 'authorised') {
      patch.payment = Object.assign({}, booking.payment, { status: 'void', voidedAt: new Date().toISOString() });
    }
    row.assign(patch).write();
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

  // Also return the minder's published availability (per-day object) so the
  // booking UI can grey out slots that fall on unavailable days/times.
  let availability = {};
  if (/^\d+$/.test(minderId)) {
    const mu = db.get('users').find({ id: Number(minderId) }).value();
    if (mu) availability = normalizeAvailability(mu);
  }
  res.json({ minderId, date, taken, availability });
});

module.exports = router;
