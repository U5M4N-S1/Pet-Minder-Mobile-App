// Shared availability helpers — used by the bookings route to enforce that
// owners cannot book a minder outside the minder's published schedule, and
// re-exported so the frontend mirror logic stays in sync via these constants.
//
// Availability data is stored on the user record as a per-day object:
//   availability: { mon: ['morning','evening'], wed: ['afternoon'], ... }
//
// Legacy flat arrays (availableDays + availableSlots) are supported via
// normalizeAvailability() which converts them into the new format.
//
// Booking time is a single "HH:MM" string. We validate by mapping the
// requested HH:MM into one of the slot buckets and checking the day-specific
// entry in the minder's availability object.

const DAY_KEYS = ['sun','mon','tue','wed','thu','fri','sat'];
const VALID_DAYS  = ['mon','tue','wed','thu','fri','sat','sun'];
const VALID_SLOTS = ['morning','afternoon','evening'];

// Hour-of-day ranges for each slot bucket. Half-open [start, end).
// Mirrors the labels shown on the minder profile UI ("Morning 8–12", etc).
const SLOT_RANGES = {
  morning:   { start: 8,  end: 12 },
  afternoon: { start: 12, end: 17 },
  evening:   { start: 17, end: 20 }
};

// Returns 'mon'|'tue'|... for a "YYYY-MM-DD" string, or null if malformed.
// Parsed in UTC so the day-of-week is independent of the server's timezone.
function dayKeyForDate(dateStr) {
  if (typeof dateStr !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null;
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (isNaN(dt.getTime())) return null;
  return DAY_KEYS[dt.getUTCDay()];
}

// Parse "HH:MM" into a numeric hour (0–23). Returns null on bad input.
function parseHour(timeStr) {
  if (typeof timeStr !== 'string') return null;
  const m = timeStr.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h + min / 60;
}

// Map an "HH:MM" string to a slot bucket key, or null if it falls outside
// every range (e.g. midnight, late evening).
function slotForTime(timeStr) {
  const h = parseHour(timeStr);
  if (h == null) return null;
  for (const [key, range] of Object.entries(SLOT_RANGES)) {
    if (h >= range.start && h < range.end) return key;
  }
  return null;
}

// Convert any stored availability shape into the canonical per-day object:
//   { mon: ['morning','evening'], ... }
//
// Handles three cases:
//   1. New format — already an object with day keys → validate and return.
//   2. Legacy flat arrays — availableDays + availableSlots → cross-product
//      (every listed day gets all listed slots, which matches old behaviour).
//   3. Missing / invalid → empty object (no availability).
function normalizeAvailability(user) {
  // Case 1: new per-day object
  if (user.availability && typeof user.availability === 'object' && !Array.isArray(user.availability)) {
    const out = {};
    for (const day of VALID_DAYS) {
      if (Array.isArray(user.availability[day])) {
        const slots = user.availability[day].filter(s => VALID_SLOTS.includes(s));
        if (slots.length) out[day] = slots;
      }
    }
    return out;
  }
  // Case 2: legacy flat arrays
  const days  = Array.isArray(user.availableDays)  ? user.availableDays.filter(d => VALID_DAYS.includes(d))  : [];
  const slots = Array.isArray(user.availableSlots) ? user.availableSlots.filter(s => VALID_SLOTS.includes(s)) : [];
  if (!days.length || !slots.length) return {};
  const out = {};
  days.forEach(d => { out[d] = slots.slice(); });
  return out;
}

// Core validator. Returns { ok: true } or { ok: false, error: string }.
//   minder       — the user row from the `users` table
//   bookingDate  — "YYYY-MM-DD"
//   bookingTime  — "HH:MM"
function validateBookingSlot(minder, bookingDate, bookingTime) {
  if (!minder) {
    return { ok: false, error: 'Minder not found' };
  }

  const day = dayKeyForDate(bookingDate);
  if (!day) {
    return { ok: false, error: 'Invalid booking date' };
  }

  const slot = slotForTime(bookingTime);
  if (!slot) {
    return { ok: false, error: 'Booking time is outside working hours' };
  }

  const avail = normalizeAvailability(minder);

  if (!Object.keys(avail).length) {
    return { ok: false, error: 'This minder has not published their availability yet' };
  }

  const daySlots = avail[day];
  if (!daySlots || !daySlots.length) {
    const label = { mon:'Monday', tue:'Tuesday', wed:'Wednesday', thu:'Thursday', fri:'Friday', sat:'Saturday', sun:'Sunday' }[day];
    return { ok: false, error: 'This minder is not available on ' + label };
  }

  if (!daySlots.includes(slot)) {
    return { ok: false, error: 'This minder is not available in the ' + slot + ' on the selected date' };
  }

  return { ok: true };
}

module.exports = {
  DAY_KEYS,
  VALID_DAYS,
  VALID_SLOTS,
  SLOT_RANGES,
  dayKeyForDate,
  slotForTime,
  normalizeAvailability,
  validateBookingSlot
};
