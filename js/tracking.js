// PawPal tracking module — simulated GPS for the booking live-map demo.
// Exposes:
//   PawTracking.geocodeCity(name)
//   PawTracking.durationForService(service) → minutes
//   PawTracking.getLiveBooking(bookings, now?) → booking or null
//   PawTracking.startTracking(opts) / stopTracking(bookingId)
//   PawTracking.loadStoredPath(bookingId)
//   PawTracking.onTick(cb) / offTick(cb)
// Paths are persisted to localStorage mid-walk and POSTed to the backend
// on stop, so a refresh during a walk doesn't lose progress.

(function () {
  const TICK_MS = 500;
  const STORAGE_PREFIX = 'pawpal-route-';

  // Small hardcoded dictionary so we don't need a geocoder / API key.
  // Keys are matched case-insensitively against the user's location field.
  const CITY_COORDS = {
    'mile end':       { lat: 51.5246, lng: -0.0333 },
    'victoria park':  { lat: 51.5363, lng: -0.0400 },
    'shoreditch':     { lat: 51.5265, lng: -0.0776 },
    'hackney':        { lat: 51.5450, lng: -0.0553 },
    'bethnal green':  { lat: 51.5270, lng: -0.0550 },
    'bow':            { lat: 51.5300, lng: -0.0200 },
    'stratford':      { lat: 51.5416, lng: -0.0030 },
    'canary wharf':   { lat: 51.5054, lng: -0.0235 },
    'whitechapel':    { lat: 51.5190, lng: -0.0610 },
    'camden':         { lat: 51.5390, lng: -0.1426 },
    'islington':      { lat: 51.5362, lng: -0.1030 },
    'kings cross':    { lat: 51.5308, lng: -0.1238 },
    'soho':           { lat: 51.5137, lng: -0.1340 },
    'london':         { lat: 51.5074, lng: -0.1278 }
  };

  function geocodeCity(name) {
    if (!name || typeof name !== 'string') return CITY_COORDS['mile end'];
    const key = name.toLowerCase();
    for (const city in CITY_COORDS) {
      if (key.includes(city)) return CITY_COORDS[city];
    }
    return CITY_COORDS['mile end'];
  }

  // Service → nominal duration in minutes. Used to derive a booking end time.
  function durationForService(service) {
    const s = String(service || '').toLowerCase();
    if (s.includes('home visit')) return 30;
    if (s.includes('grooming'))   return 60;
    if (s.includes('walk'))       return 60;
    return 60;
  }

  // Build start/end Date for a booking (bookingDate YYYY-MM-DD, bookingTime HH:MM).
  function windowFor(booking) {
    if (!booking || !booking.bookingDate || !booking.bookingTime) return null;
    const start = new Date(booking.bookingDate + 'T' + booking.bookingTime + ':00');
    if (isNaN(start)) return null;
    const end = new Date(start.getTime() + durationForService(booking.service) * 60000);
    return { start, end };
  }

  // Find the booking that's live "right now". Prefers one that's already started.
  function getLiveBooking(bookings, now) {
    now = now || new Date();
    if (!Array.isArray(bookings)) return null;
    for (const b of bookings) {
      if (b.status && (b.status === 'cancelled' || b.status === 'declined' || b.status === 'pending')) continue;
      const w = windowFor(b);
      if (!w) continue;
      if (now >= w.start && now < w.end) return b;
    }
    return null;
  }

  // Deterministic pseudo-random so a given booking id produces the same walk.
  function seededRng(seed) {
    let s = Math.abs(seed | 0) || 1;
    return function () {
      s = (s * 16807) % 2147483647;
      return s / 2147483647;
    };
  }

  // Convert a (bearing, meters) offset from a lat/lng origin back to a lat/lng.
  // Accounts for longitude shrinking with latitude — important at London's 51.5°.
  function offsetMeters(point, bearingRad, meters) {
    const metersPerDegLat = 111320;
    const metersPerDegLng = 111320 * Math.cos(point.lat * Math.PI / 180);
    return {
      lat: point.lat + (Math.cos(bearingRad) * meters) / metersPerDegLat,
      lng: point.lng + (Math.sin(bearingRad) * meters) / metersPerDegLng
    };
  }

  // Build a realistic walking loop: start → 3 waypoints → start, spread evenly
  // across the booking window. Total path length ≈ 2 km (~1.2 mi) — typical for
  // an hour-long dog walk at ~2 mph once stops/sniffs are factored in. Last
  // point is forced to equal the start so the recorded path ends "home".
  function buildFullPath(start, count, seed) {
    const rng = seededRng(seed);
    // Randomise the loop's orientation so different bookings look different,
    // and alternate clockwise/anticlockwise for a bit of visual variety.
    const baseBearing = rng() * Math.PI * 2;
    const spin        = rng() > 0.5 ? 1 : -1;
    const armMeters   = 850 + rng() * 300; // 850–1150 m from start to each waypoint

    // Three waypoints at 120° apart from each other, anchored on baseBearing.
    // start → wp1 (≈ armMeters) → wp2 (≈ arm·√3) → wp3 (≈ arm·√3) → start (≈ arm)
    // Total ≈ arm · (2 + 2√3) ≈ 4.9–6.3 km for a 1-hour walk (a healthy pace).
    const wp1 = offsetMeters(start, baseBearing,                         armMeters);
    const wp2 = offsetMeters(start, baseBearing + spin * (Math.PI * 2/3), armMeters);
    const wp3 = offsetMeters(start, baseBearing + spin * (Math.PI * 4/3), armMeters);
    const legs = [ [start, wp1], [wp1, wp2], [wp2, wp3], [wp3, start] ];

    // Distribute ticks proportionally by leg length so the marker moves at an
    // approximately constant speed instead of sprinting one leg and crawling another.
    function legLengthM([a, b]) {
      const dLat = (b.lat - a.lat) * 111320;
      const dLng = (b.lng - a.lng) * 111320 * Math.cos(a.lat * Math.PI / 180);
      return Math.hypot(dLat, dLng);
    }
    const lengths = legs.map(legLengthM);
    const totalLen = lengths.reduce((s, x) => s + x, 0) || 1;

    const points = [];
    for (let i = 0; i < legs.length; i++) {
      const [from, to] = legs[i];
      const share      = Math.max(2, Math.round((lengths[i] / totalLen) * count));
      for (let k = 0; k < share; k++) {
        const f = k / share;
        points.push({
          lat: from.lat + (to.lat - from.lat) * f,
          lng: from.lng + (to.lng - from.lng) * f
        });
      }
    }
    // Force the final point to exactly match the start.
    points.push({ lat: start.lat, lng: start.lng });
    return points;
  }

  // ── In-memory state ──────────────────────────────────────────────────
  const active = {};        // bookingId → { intervalId, path, startCoord, endsAt, fullPath, startedAt }
  const tickListeners = [];

  function storageKey(id) { return STORAGE_PREFIX + id; }

  function loadStoredPath(bookingId) {
    try {
      const raw = localStorage.getItem(storageKey(bookingId));
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }

  function saveStoredPath(bookingId, data) {
    try { localStorage.setItem(storageKey(bookingId), JSON.stringify(data)); }
    catch { /* quota — ignore */ }
  }

  function clearStoredPath(bookingId) {
    try { localStorage.removeItem(storageKey(bookingId)); } catch {}
  }

  function emitTick(bookingId) {
    const state = active[bookingId];
    if (!state) return;
    tickListeners.forEach(fn => {
      try { fn(bookingId, state.path.slice(), state); } catch {}
    });
  }

  function onTick(fn) { tickListeners.push(fn); }
  function offTick(fn) {
    const i = tickListeners.indexOf(fn);
    if (i >= 0) tickListeners.splice(i, 1);
  }

  function isTracking(bookingId) { return !!active[bookingId]; }

  // Start (or resume) tracking. Safe to call repeatedly.
  function startTracking(opts) {
    const { bookingId, startCoord, startsAt, endsAt, service } = opts;
    if (!bookingId || !startCoord) return null;
    if (active[bookingId]) return active[bookingId];

    const nowMs   = Date.now();
    const startMs = startsAt ? new Date(startsAt).getTime() : nowMs;
    const endMs   = endsAt   ? new Date(endsAt).getTime()   : (nowMs + durationForService(service) * 60000);
    const totalMs = Math.max(endMs - startMs, TICK_MS * 2);
    const totalTicks = Math.max(Math.floor(totalMs / TICK_MS), 4);
    const fullPath   = buildFullPath(startCoord, totalTicks, bookingId);

    // Restore prior path if the user refreshed mid-walk.
    const prior = loadStoredPath(bookingId);
    const path  = (prior && Array.isArray(prior.path)) ? prior.path.slice() : [];

    const state = {
      bookingId, startCoord, startedAt: startMs, endsAt: endMs,
      fullPath, path, intervalId: null
    };

    function tick() {
      const elapsed   = Date.now() - startMs;
      const stepIndex = Math.min(Math.floor(elapsed / TICK_MS), fullPath.length - 1);
      // Append any ticks we've passed (handles refresh gaps too).
      while (state.path.length <= stepIndex) {
        const pt = fullPath[state.path.length];
        state.path.push({ lat: pt.lat, lng: pt.lng, t: startMs + state.path.length * TICK_MS });
      }
      saveStoredPath(bookingId, { path: state.path, startCoord, endsAt: endMs });
      emitTick(bookingId);
      if (Date.now() >= endMs) stopTracking(bookingId, true);
    }

    tick(); // seed immediately so the map has something to draw
    state.intervalId = setInterval(tick, TICK_MS);
    active[bookingId] = state;
    return state;
  }

  async function stopTracking(bookingId, autoFinished) {
    const state = active[bookingId];
    if (!state) return;
    clearInterval(state.intervalId);
    delete active[bookingId];

    // Ensure the path ends exactly at the start point — the demo "return home".
    if (state.path.length) {
      const last = state.path[state.path.length - 1];
      const dx = last.lat - state.startCoord.lat;
      const dy = last.lng - state.startCoord.lng;
      if (Math.hypot(dx, dy) > 1e-6) {
        state.path.push({ lat: state.startCoord.lat, lng: state.startCoord.lng, t: Date.now() });
      }
    }

    const payload = {
      path: state.path,
      startCoord: state.startCoord,
      endedAt: new Date().toISOString()
    };

    // Only attempt backend save if the app's api helper is present.
    if (typeof api !== 'undefined' && api && typeof api._req === 'function') {
      try {
        await api._req('PUT', '/routes/' + bookingId, payload);
        clearStoredPath(bookingId);
      } catch {
        // Keep it in localStorage so we can retry on next load.
      }
    }
    emitTick(bookingId); // one last paint so UI shows the full path
    return payload;
  }

  window.PawTracking = {
    geocodeCity, durationForService, windowFor, getLiveBooking,
    startTracking, stopTracking, loadStoredPath, isTracking,
    onTick, offTick, TICK_MS
  };
})();
