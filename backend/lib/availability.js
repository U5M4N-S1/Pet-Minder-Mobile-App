// Shared availability helpers — used by the bookings route to enforce that
// owners cannot book a minder outside the minder's published schedule, and
// re-exported so the frontend mirror logic stays in sync via these constants.
//
// Availability data is stored on the user record as:
//   availableDays:  ['mon','tue', ...]            // ISO-style 3-letter codes
//   availableSlots: ['morning','afternoon', ...]  // bucket the day into 3 ranges
//
// Booking time is a single "HH:MM" string. We validate by mapping the
// requested HH:MM into one of the slot buckets and checking that BOTH the
// day-of-week and the slot are present on the minder's record.

const DAY_KEYS = ['sun','mon','tue','wed','thu','fri','sat'];

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

// Core validator. Returns { ok: true } or { ok: false, error: string }.
//   minder       — the user row from the `users` table (or any object with
//                  availableDays / availableSlots arrays)
//   bookingDate  — "YYYY-MM-DD"
//   bookingTime  — "HH:MM"
//
// All branches return a clear, user-facing error string so the route can
// pass it straight through to the client without rephrasing.
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

  const days  = Array.isArray(minder.availableDays)  ? minder.availableDays  : [];
  const slots = Array.isArray(minder.availableSlots) ? minder.availableSlots : [];

  if (!days.length || !slots.length) {
    return { ok: false, error: 'This minder has not published their availability yet' };
  }

  if (!days.includes(day)) {
    const label = { mon:'Monday', tue:'Tuesday', wed:'Wednesday', thu:'Thursday', fri:'Friday', sat:'Saturday', sun:'Sunday' }[day];
    return { ok: false, error: 'This minder is not available on ' + label };
  }

  if (!slots.includes(slot)) {
    return { ok: false, error: 'This minder is not available in the ' + slot + ' on the selected date' };
  }

  return { ok: true };
}

module.exports = {
  DAY_KEYS,
  SLOT_RANGES,
  dayKeyForDate,
  slotForTime,
  validateBookingSlot
};
