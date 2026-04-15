let currentScreen = 'landing';
let previousScreen = null;
const appScreens = ['home', 'search', 'bookings', 'messages', 'profile'];
let isAdmin = false;
let selectedRole = 'owner';
let reviewStars = 0;
let profileReviewStars = 0;
let currentEditPetId = null;
let currentReviewMinder = null;

// Chat state
let chatListCache = [];

// Registration pets (staged before account exists)
let regPendingPets = [];
let regPetNextId   = 1;

// Report modal
let currentReportTarget = null;

// Canonical minder services + visual metadata
const MINDER_SERVICES = ['Walking', 'Home Visit', 'Grooming', 'Vet', 'Training'];
const SERVICE_META = {
  'Walking':    { emoji: '🚶', theme: 'walk'  },
  'Home Visit': { emoji: '🏠', theme: 'home'  },
  'Grooming':   { emoji: '✂️', theme: 'groom' },
  'Vet':        { emoji: '🩺', theme: 'vet'   },
  'Training':   { emoji: '🎾', theme: 'train' }
};

function servicePriceChip(name, price) {
  const meta = SERVICE_META[name] || { emoji: '🐾', theme: 'walk' };
  return '<span class="svc-chip svc-chip--' + meta.theme + '">' +
    '<span class="svc-chip-emoji">' + meta.emoji + '</span>' +
    '<span class="svc-chip-name">' + escapeHTML(name) + '</span>' +
    '<span class="svc-chip-price">£' + Number(price) + '/hr</span>' +
    '</span>';
}
function buildServicePricesHTML(prefix, current) {
  const c = current || {};
  return MINDER_SERVICES.map(name => {
    const id  = prefix + '-price-' + name.toLowerCase().replace(/\s+/g, '-');
    const val = Number(c[name]) > 0 ? Number(c[name]) : '';
    return '<div class="service-price-row">' +
      '<label for="' + id + '">' + name + '</label>' +
      '<div class="service-price-input">' +
        '<span class="currency">£</span>' +
        '<input type="number" id="' + id + '" min="0" max="999" step="1" placeholder="0" value="' + val + '">' +
        '<span class="per">/ hr</span>' +
      '</div></div>';
  }).join('');
}
function readServicePrices(prefix) {
  const out = {};
  MINDER_SERVICES.forEach(name => {
    const el = document.getElementById(prefix + '-price-' + name.toLowerCase().replace(/\s+/g, '-'));
    if (!el) return;
    const n = Math.floor(Number(el.value));
    out[name] = (isFinite(n) && n > 0) ? Math.min(n, 999) : 0;
  });
  return out;
}

// Availability helpers (mirror backend SLOT_RANGES)
const AVAIL_SLOT_RANGES = {
  morning:   { start: 8,  end: 12 },
  afternoon: { start: 12, end: 17 },
  evening:   { start: 17, end: 21 }
};
const AVAIL_DAY_KEYS   = ['sun','mon','tue','wed','thu','fri','sat'];
const AVAIL_DAY_LABELS = { mon:'Monday', tue:'Tuesday', wed:'Wednesday', thu:'Thursday', fri:'Friday', sat:'Saturday', sun:'Sunday' };

let reportSelectedUser = null;

// User profile — populated from the session cache or API on page load
let userProfile = {
  firstName: '', lastName: '', email: '', phone: '', location: '', bio: '',
  role: ['owner'], profileImage: '',
  // Minder-specific (blank for owners)
  serviceArea: '', petsCaredFor: '', services: '', rate: '', experience: '',
  priceMin: 10, priceMax: 25, servicePrices: {},
  availableForBooking: true,
  enabledServices: [],
};

// ===== LOCAL STORE =====
// Thin wrapper around localStorage. The current session is stored under a
// single `pawpal_user` key; everything that must be ISOLATED PER ACCOUNT
// (currently just pets) is namespaced as `pawpal_pets_<userId>` so one
// account can never see another account's data.
//
// Accounts themselves live on the backend in `backend/pawpal.json` via
// lowdb — localStorage is purely a session + client-side cache.
const store = {
  USER_KEY:  'pawpal_user',
  TOKEN_KEY: 'pawpal_token',
  _petsKey(userId) { return 'pawpal_pets_' + userId; },

  getUser() {
    try { return JSON.parse(localStorage.getItem(this.USER_KEY)) || null; }
    catch { return null; }
  },
  setUser(user) {
    localStorage.setItem(this.USER_KEY, JSON.stringify(user));
  },
  clearSession() {
    localStorage.removeItem(this.USER_KEY);
    localStorage.removeItem(this.TOKEN_KEY);
    // Per-user pet keys are left in place on purpose so a user's pets come
    // back if they log out and log back in on the same device.
  },
  currentUserId() {
    const u = this.getUser();
    return u && u.id != null ? u.id : null;
  },

  getPets() {
    const id = this.currentUserId();
    if (id == null) return null;
    try { return JSON.parse(localStorage.getItem(this._petsKey(id))) || null; }
    catch { return null; }
  },
  setPets(pets) {
    const id = this.currentUserId();
    if (id == null) return; // no logged-in user → nothing to persist
    localStorage.setItem(this._petsKey(id), JSON.stringify(pets));
  },
};

// ===== API =====
const api = {
  _base: '/api',
  getToken()  { return localStorage.getItem(store.TOKEN_KEY); },
  setToken(t) { localStorage.setItem(store.TOKEN_KEY, t); },
  clearSession() { store.clearSession(); },

  async _req(method, path, body) {
    const opts = { method, headers: { 'Content-Type': 'application/json' } };
    const token = this.getToken();
    if (token) opts.headers['Authorization'] = 'Bearer ' + token;
    if (body)  opts.body = JSON.stringify(body);
    const res  = await fetch(this._base + path, opts);
    // 204 No Content (e.g. DELETE /pets/:id) has an empty body — don't
    // try to parse it as JSON.
    if (res.status === 204) {
      if (!res.ok) throw new Error('Request failed');
      return null;
    }
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  },

  login(email, password)    { return this._req('POST',   '/auth/login',  { email, password }); },
  signup(data)              { return this._req('POST',   '/auth/signup', data); },
  forgotPassword(email)     { return this._req('POST',   '/auth/forgot-password', { email }); },
  resetPassword(email, code, newPassword) { return this._req('POST', '/auth/reset-password', { email, code, newPassword }); },
  getMe()                   { return this._req('GET',    '/auth/me'); },
  updateMe(data)            { return this._req('PATCH',  '/auth/me', data); },
  getBookings()             { return this._req('GET',    '/bookings'); },
  getBookingRequests()      { return this._req('GET',    '/bookings/requests'); },
  updateBooking(id, data)   { return this._req('PATCH',  '/bookings/' + id, data); },
  getMinderTakenTimes(minderId, date) { return this._req('GET', '/bookings/minder/' + minderId + '/taken?date=' + encodeURIComponent(date)); },
  getNotifications()        { return this._req('GET',    '/notifications'); },
  markNotificationRead(id)  { return this._req('PATCH',  '/notifications/' + id, { read: true }); },
  deleteNotification(id)    { return this._req('DELETE', '/notifications/' + id); },
  createBooking(data)       { return this._req('POST',   '/bookings', data); },
  getPets()                 { return this._req('GET',    '/pets'); },
  createPet(data)           { return this._req('POST',   '/pets', data); },
  updatePet(id, data)       { return this._req('PATCH',  '/pets/' + id, data); },
  deletePet(id)             { return this._req('DELETE', '/pets/' + id); },
  // Profile image
  uploadAvatar(image)       { return this._req('POST',   '/auth/avatar', { image }); },
  deleteAvatar()            { return this._req('DELETE', '/auth/avatar'); },
  uploadQualification(image){ return this._req('POST',   '/auth/qualifications', { image }); },
  deleteQualification(id)   { return this._req('DELETE', '/auth/qualifications/' + id); },
  setAvailability(val)          { return this._req('PATCH',  '/auth/me', { availableForBooking: val }); },
  applyForServices(services)    { return this._req('PATCH',  '/auth/me/service-applications', { services }); },
  // Chats
  getChats()                { return this._req('GET',    '/chats'); },
  getChatMessages(id)       { return this._req('GET',    '/chats/' + id + '/messages'); },
  sendChatMessage(id, text, image) { const body = {}; if (text) body.text = text; if (image) body.image = image; return this._req('POST', '/chats/' + id + '/messages', body); },
  createChat(otherUserId)   { return this._req('POST',   '/chats', { otherUserId }); },
  deleteMessage(chatId, msgId) { return this._req('DELETE', '/chats/' + chatId + '/messages/' + msgId); },
  hideChat(chatId)          { return this._req('DELETE', '/chats/' + chatId); },
  adminDeleteQualification(userId, imgId){ return this._req('DELETE', '/admin/qualifications/' + userId + '/' + imgId); },
  getAdminUserReviews(userId)            { return this._req('GET',    '/admin/users/' + userId + '/reviews'); },
  adminDeleteReview(id)                  { return this._req('DELETE', '/admin/reviews/' + id); },
  // Reviews
  getMinderReviews(minderId) { return this._req('GET',    '/reviews/minder/' + minderId); },
  submitReview(data)         { return this._req('POST',   '/reviews', data); },
  deleteReview(id)           { return this._req('DELETE', '/reviews/' + id); },
  getMyReviews()             { return this._req('GET',    '/reviews/mine'); },
  // Payout
  getPayout()                { return this._req('GET',    '/auth/payout'); },
  updatePayout(data)         { return this._req('PUT',    '/auth/payout', data); },
  // Routes
  getRoute(bookingId)        { return this._req('GET',    '/routes/' + bookingId); },
  getUserRoutes()            { return this._req('GET',    '/routes/mine'); },
  // Admin service toggle
  toggleAdminService(id, service, enabled) { return this._req('PATCH', '/admin/users/' + id + '/services', { service, enabled }); },
  // Minders (public)
  getMinders()              { return this._req('GET',    '/minders'); },
  // Admin
  getAdminUsers()           { return this._req('GET',    '/admin/users'); },
  updateAdminUser(id, data) { return this._req('PATCH',  '/admin/users/' + id, data); },
  deleteAdminUser(id)       { return this._req('DELETE', '/admin/users/' + id); },
  getDisputes()             { return this._req('GET',    '/admin/disputes'); },
  createDispute(data)       { return this._req('POST',   '/admin/disputes', data); },
  updateDispute(id, data)   { return this._req('PATCH',  '/admin/disputes/' + id, data); },
};

// Hydrate userProfile from localStorage immediately (sync) so pages render
// the correct name before the async /me call completes.
function hydrateUserProfile(u) {
  if (!u) return;
  userProfile.id           = u.id;
  userProfile.firstName    = u.firstName    || '';
  userProfile.lastName     = u.lastName     || '';
  userProfile.email        = u.email        || '';
  userProfile.phone        = u.phone        || '';
  userProfile.location     = u.location     || '';
  userProfile.bio          = u.bio          || '';
  userProfile.role         = Array.isArray(u.role) ? u.role : [u.role || 'owner'];
  userProfile.profileImage = u.profileImage || '';
  userProfile.serviceArea  = u.serviceArea  || '';
  userProfile.petsCaredFor = u.petsCaredFor || '';
  userProfile.services     = u.services     || '';
  userProfile.rate         = u.rate         || '';
  userProfile.experience   = u.experience   || '';
  userProfile.priceMin         = u.priceMin != null ? u.priceMin : 10;
  userProfile.priceMax         = u.priceMax != null ? u.priceMax : 25;
  userProfile.availableForBooking = u.availableForBooking !== false;
  userProfile.availability     = (u.availability && typeof u.availability === 'object' && !Array.isArray(u.availability)) ? u.availability : {};
  userProfile.servicePrices    = (u.servicePrices && typeof u.servicePrices === 'object') ? u.servicePrices : {};
  userProfile.enabledServices  = Array.isArray(u.enabledServices) ? u.enabledServices : [];
  userProfile.qualificationImages  = Array.isArray(u.qualificationImages) ? u.qualificationImages : [];
  userProfile.certificationTags = Array.isArray(u.certificationTags) ? u.certificationTags : [];
}
(function initUserFromCache() { hydrateUserProfile(store.getUser()); }());

// Minder data for profiles
// Previously booked minders (for review system)
// Booking lists are always fetched from `GET /api/bookings` (filtered by
// ownerId on the server). These empty arrays exist purely as a fallback
// shape for when the fetch fails — never populated with mock data, so a
// fresh account can't accidentally see another user's bookings.
const statusLabels = { confirmed: 'Confirmed', pending: 'Pending', completed: 'Done', declined: 'Declined', cancelled: 'Cancelled' };

// All loaded bookings — stored so the detail view can look them up by id
let allBookingsCache = [];

// ── Booking filters (single source of truth) ────────────────────────────────
// Active lists never include declined/cancelled/completed. Pending stays in
// the owner's Upcoming view (owners have no Requests tab); accepted bookings
// always live in Upcoming. Past contains everything that is no longer active.
const ACTIVE_STATUSES = ['pending', 'confirmed'];
const PAST_STATUSES   = ['completed', 'cancelled', 'declined'];
function filterUpcoming(bookings) { return (bookings || []).filter(b => ACTIVE_STATUSES.includes(b.status)); }
function filterPast(bookings)     { return (bookings || []).filter(b => PAST_STATUSES.includes(b.status)); }

// Render a minder's picture as either an emoji/glyph or an <img> if we have
// a real data-URI profile image stored on the booking. Falls back to the
// default 👤 glyph if nothing sensible is available.
function bookingAvatarHTML(b) {
  const img = b && b.minderImage;
  if (img && typeof img === 'string' && img.startsWith('data:image/')) {
    return '<img src="' + img + '" alt="' + (b.minderName || 'Minder') + '" class="avatar-img">';
  }
  const glyph = (b && b.avatar) ? b.avatar : '👤';
  // If someone put a data URI into the legacy avatar field, render that too
  if (typeof glyph === 'string' && glyph.startsWith('data:image/')) {
    return '<img src="' + glyph + '" alt="' + (b.minderName || 'Minder') + '" class="avatar-img">';
  }
  return glyph;
}

function renderBookingCards(containerId, bookings) {
  const el = document.getElementById(containerId);
  if (!el) return;
  if (!bookings || bookings.length === 0) {
    el.innerHTML = '<div style="padding:40px;text-align:center;color:var(--bark-light);font-size:14px">No bookings to show.</div>';
    return;
  }
  el.innerHTML = bookings.map(b => `
    <div class="booking-card" onclick="openBookingDetail(${b.id})" style="cursor:pointer">
      <div class="booking-date-block"><div class="booking-date-day">${b.day}</div><div class="booking-date-month">${b.month}</div></div>
      <div class="booking-date-sep"></div>
      <div class="booking-avatar">${bookingAvatarHTML(b)}</div>
      <div class="booking-info">
        <div class="booking-minder">${b.minderName || 'Minder'}</div>
        <div class="booking-detail">${b.petEmoji} ${b.petDetail}</div>
        ${b.price ? `<div class="booking-detail" style="margin-top:4px;color:var(--terra)">${b.price}</div>` : ''}
      </div>
      <span class="booking-status status-${b.status}">${statusLabels[b.status] || b.status}</span>
    </div>`).join('');
}

function openBookingDetail(bookingId) {
  const b = allBookingsCache.find(x => x.id === bookingId);
  if (!b) return;
  const el = document.getElementById('booking-detail-content');
  if (!el) return;
  const canCancel       = (b.status === 'pending' || b.status === 'confirmed') && String(b.ownerId) === String(store.currentUserId());
  const isMinder        = String(b.minder) === String(store.currentUserId());
  const canComplete     = isMinder && b.status === 'confirmed';
  const minderCanCancel = isMinder && (b.status === 'pending' || b.status === 'confirmed');

  el.innerHTML =
    '<div style="background:white;border-radius:var(--radius);padding:20px;box-shadow:0 2px 12px var(--shadow)">' +
      '<div style="display:flex;align-items:center;gap:14px;margin-bottom:18px">' +
        '<div class="booking-avatar" style="width:56px;height:56px;font-size:28px;flex-shrink:0;overflow:hidden">' + bookingAvatarHTML(b) + '</div>' +
        '<div><div style="font-family:\'Playfair Display\',serif;font-size:18px;font-weight:600;color:var(--bark)">' + b.minderName + '</div>' +
        '<span class="booking-status status-' + b.status + '" style="margin-top:4px;display:inline-block">' + (statusLabels[b.status] || b.status) + '</span></div>' +
      '</div>' +
      '<div style="display:flex;flex-direction:column;gap:10px">' +
        '<div class="info-row" style="display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--sand-light)"><span style="color:var(--bark-light);font-size:13px">Date</span><span style="font-weight:600;font-size:14px;color:var(--bark)">' + b.day + ' ' + b.month + '</span></div>' +
        '<div class="info-row" style="display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--sand-light)"><span style="color:var(--bark-light);font-size:13px">Time</span><span style="font-weight:600;font-size:14px;color:var(--bark)">' + (b.bookingTime || '') + '</span></div>' +
        '<div class="info-row" style="display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--sand-light)"><span style="color:var(--bark-light);font-size:13px">Service</span><span style="font-weight:600;font-size:14px;color:var(--bark)">' + (b.service || '') + '</span></div>' +
        '<div class="info-row" style="display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--sand-light)"><span style="color:var(--bark-light);font-size:13px">Pet(s)</span><span style="font-weight:600;font-size:14px;color:var(--bark)">' + b.petEmoji + ' ' + (b.petDetail ? b.petDetail.split('·')[0].trim() : '') + '</span></div>' +
        (b.price ? '<div class="info-row" style="display:flex;justify-content:space-between;padding:10px 0"><span style="color:var(--bark-light);font-size:13px">Price</span><span style="font-weight:700;font-size:16px;color:var(--terra)">' + b.price + '</span></div>' : '') +
      '</div>' +
    '</div>' +
    (canComplete ?
      '<button class="btn-primary" style="width:100%;margin-top:16px;padding:14px;font-size:14px" onclick="markBookingComplete(' + b.id + ')">✅ Mark Complete</button>'
    : '') +
    (minderCanCancel ?
      '<button class="btn-outline" style="width:100%;margin-top:10px;padding:13px;color:#e53935;border-color:#e53935;font-size:14px" onclick="minderCancelBooking(' + b.id + ')">Cancel Booking</button>'
    : '') +
    (canCancel ?
      '<button class="btn-outline" style="width:100%;margin-top:10px;padding:13px;color:#e53935;border-color:#e53935;font-size:14px" onclick="cancelBooking(' + b.id + ')">Cancel Booking</button>'
    : '');
  document.getElementById('bookings-detail-section').style.display = 'block';
  document.getElementById('bookings-main-section').style.display = 'none';
}

function closeBookingDetail() {
  document.getElementById('bookings-detail-section').style.display = 'none';
  document.getElementById('bookings-main-section').style.display = 'block';
}


async function markBookingComplete(bookingId) {
  showConfirmModal('✅', 'Mark as Complete?', 'Confirm the service is finished. The owner will be notified and can leave a review.', async function() {
    try {
      await api.updateBooking(bookingId, { status: 'completed' });
      showToast('✅ Booking marked as complete!');
      closeBookingDetail();
      const bookings = await loadAllBookingsForUser();
      allBookingsCache = bookings;
      renderBookingCards('bookings-upcoming-list', filterUpcoming(bookings));
      renderBookingCards('bookings-past-list',     filterPast(bookings));
      initLiveTracking(bookings);
      loadNotificationCount();
    } catch (err) {
      showToast('❌ ' + (err.message || 'Failed to complete booking'));
    }
  });
}

function minderCancelBooking(bookingId) {
  showConfirmModal('🗑', 'Cancel Booking?', 'Are you sure you want to cancel this booking? The customer will be notified.', async function() {
    try {
      await api.updateBooking(bookingId, { status: 'cancelled' });
      showToast('✅ Booking cancelled');
      closeBookingDetail();
      try {
        const bookings = await loadAllBookingsForUser();
        allBookingsCache = bookings;
        renderBookingCards('bookings-upcoming-list', filterUpcoming(bookings));
        renderBookingCards('bookings-past-list',     filterPast(bookings));
      } catch { /* silent */ }
    } catch (err) {
      showToast('❌ ' + (err.message || 'Failed to cancel booking'));
    }
  });
}

function cancelBooking(bookingId) {
  showConfirmModal('🗑', 'Cancel Booking?', 'Are you sure you want to cancel this booking? This cannot be undone.', async function() {
    try {
      await api.updateBooking(bookingId, { status: 'cancelled' });
      showToast('✅ Booking cancelled');
      closeBookingDetail();
      // Refresh bookings list
      try {
        const bookings = await api.getBookings();
        allBookingsCache = bookings;
        renderBookingCards('bookings-upcoming-list', filterUpcoming(bookings));
        renderBookingCards('bookings-past-list',     filterPast(bookings));
      } catch { /* silent */ }
    } catch (err) {
      showToast('❌ ' + (err.message || 'Failed to cancel booking'));
    }
  });
}

// ===== BOOKING REQUESTS (minder view) =====
async function loadBookingRequests() {
  const el = document.getElementById('bookings-requests-list');
  if (!el) return;
  el.innerHTML = '<div style="padding:20px;text-align:center;color:var(--bark-light);font-size:13px">Loading requests...</div>';
  try {
    // Requests tab shows only PENDING requests. Once the minder accepts or
    // declines one it leaves this list — accepted bookings move to the
    // Upcoming tab and declined/cancelled ones disappear from active views.
    const all = await api.getBookingRequests();
    const requests = all.filter(b => b.status === 'pending');
    if (requests.length === 0) {
      el.innerHTML = '<div style="padding:40px;text-align:center;color:var(--bark-light);font-size:14px">No pending booking requests.</div>';
      return;
    }
    el.innerHTML = requests.map(b => `
      <div class="booking-card" style="cursor:default;flex-wrap:wrap">
        <div class="booking-date-block"><div class="booking-date-day">${b.day}</div><div class="booking-date-month">${b.month}</div></div>
        <div class="booking-date-sep"></div>
        <div class="booking-avatar">${b.avatar}</div>
        <div class="booking-info">
          <div class="booking-minder">${b.ownerName || 'Pet Owner'}</div>
          <div class="booking-detail">${b.petEmoji} ${b.petDetail}</div>
          ${b.price ? '<div class="booking-detail" style="margin-top:4px;color:var(--terra)">' + b.price + '</div>' : ''}
        </div>
        <span class="booking-status status-${b.status}">${statusLabels[b.status] || b.status}</span>
        ${b.status === 'pending' ? '<div class="booking-request-actions" style="width:100%;display:flex;gap:8px;margin-top:10px;padding-left:62px"><button class="btn-primary" style="flex:1;padding:10px;font-size:13px" onclick="respondToBooking(' + b.id + ',\'confirmed\',this)">Accept</button><button class="btn-outline" style="flex:1;padding:10px;font-size:13px;color:var(--bark-light);border-color:var(--sand)" onclick="respondToBooking(' + b.id + ',\'declined\',this)">Decline</button></div>' : ''}
      </div>`).join('');
  } catch {
    el.innerHTML = '<div style="padding:40px;text-align:center;color:var(--bark-light);font-size:14px">Could not load requests.</div>';
  }
}

async function respondToBooking(bookingId, status, btnEl) {
  // Disable buttons to prevent double-click
  const row = btnEl.closest('.booking-request-actions');
  if (row) row.querySelectorAll('button').forEach(b => b.disabled = true);
  try {
    await api.updateBooking(bookingId, { status });
    showToast(status === 'confirmed' ? '✅ Booking accepted!' : '❌ Booking declined');
    loadBookingRequests();        // refresh the requests list
    loadNotificationCount();      // update badge
    // Also refresh the owner-side Upcoming/Past lists on the same page so
    // a freshly-accepted booking immediately moves to Upcoming and a
    // declined one disappears from the active view.
    try {
      if (document.getElementById('bookings-upcoming-list')) {
        const bookings = await api.getBookings();
        allBookingsCache = bookings;
        renderBookingCards('bookings-upcoming-list', filterUpcoming(bookings));
        renderBookingCards('bookings-past-list',     filterPast(bookings));
      }
    } catch { /* silent */ }
  } catch (err) {
    showToast('❌ ' + (err.message || 'Failed to update booking'));
    if (row) row.querySelectorAll('button').forEach(b => b.disabled = false);
  }
}

// ===== NOTIFICATIONS =====
// Minders see incoming booking requests. Owners see system notifications
// (e.g. "your request was declined because the minder accepted another
// booking for that slot"). Both come through the same notification UI.
let notifCount = 0;
let notifRequests = [];      // minder: pending booking requests
let notifOwnerMessages = []; // owner: system notifications from /api/notifications
let notifMinderMessages = []; // minder: system notifications (service updates etc.)

async function loadNotificationCount() {
  try {
    const _nRoles = Array.isArray(userProfile.role) ? userProfile.role : [userProfile.role || 'owner'];
    if (_nRoles.includes('minder')) {
      // Minders see both booking requests AND system notifications (e.g. service updates)
      [notifRequests, notifMinderMessages] = await Promise.all([
        api.getBookingRequests(),
        api.getNotifications()
      ]);
      const pendingCount  = notifRequests.filter(b => b.status === 'pending').length;
      const unreadCount   = notifMinderMessages.filter(n => !n.read).length;
      notifCount = pendingCount + unreadCount;
    } else {
      notifOwnerMessages = await api.getNotifications();
      notifCount = notifOwnerMessages.filter(n => !n.read).length;
    }
    const badge = document.getElementById('notif-badge');
    if (badge) {
      badge.textContent = notifCount;
      badge.style.display = notifCount > 0 ? 'inline-flex' : 'none';
    }
  } catch { /* silent */ }
}

function openNotifications() {
  previousScreen = currentScreen;
  const list = document.getElementById('notif-list');

  const _oRoles = Array.isArray(userProfile.role) ? userProfile.role : [userProfile.role || 'owner'];
  if (_oRoles.includes('minder')) {
    if (list) {
      const pending = notifRequests.filter(b => b.status === 'pending');
      const rest    = notifRequests.filter(b => b.status !== 'pending');

      // Build booking request rows
      const bookingRows = pending.concat(rest).map(b => {
        const isPending = b.status === 'pending';
        return '<div class="menu-item" style="' + (isPending ? 'border-left:3px solid var(--terra);' : 'opacity:0.7;') + '" onclick="window.location.href=\'bookings.html?tab=requests\'">' +
          '<span class="menu-icon">' + (isPending ? '🔔' : (b.status === 'confirmed' ? '✅' : '❌')) + '</span>' +
          '<span class="menu-label" style="display:flex;flex-direction:column;gap:2px">' +
            '<span style="font-weight:600;font-size:14px">' + (b.ownerName || 'Pet Owner') + '</span>' +
            '<span style="font-size:12px;color:var(--bark-light)">' + b.service + ' · ' + b.day + ' ' + b.month + ' · ' + b.price + '</span>' +
            '<span style="font-size:11px;color:' + (isPending ? 'var(--terra)' : 'var(--bark-light)') + ';font-weight:' + (isPending ? '600' : '400') + '">' + (statusLabels[b.status] || b.status) + '</span>' +
          '</span>' +
          '<span class="menu-arrow">›</span>' +
        '</div>';
      });

      // Build system notification rows (service updates etc.) — unread first
      const sysUnread = notifMinderMessages.filter(n => !n.read);
      const sysRead   = notifMinderMessages.filter(n =>  n.read);
      const sysRows = sysUnread.concat(sysRead).map(n => {
        const unread = !n.read;
        const icon = n.type === 'service_update' ? '🛎' : '🔔';
        return '<div class="menu-item" style="' + (unread ? 'border-left:3px solid var(--terra);' : 'opacity:0.75;') + '" onclick="handleMinderNotifClick(' + n.id + ')">' +
          '<span class="menu-icon">' + icon + '</span>' +
          '<span class="menu-label" style="display:flex;flex-direction:column;gap:2px">' +
            '<span style="font-weight:600;font-size:14px">' + (n.title || 'Notification') + '</span>' +
            '<span style="font-size:12px;color:var(--bark-light);line-height:1.4">' + (n.message || '') + '</span>' +
          '</span>' +
          '<button onclick="event.stopPropagation();deleteMinderNotif(' + n.id + ')" style="background:none;border:none;cursor:pointer;padding:6px;color:#ff0000;font-size:15px;flex-shrink:0;line-height:1" title="Delete">🗑</button>' +
        '</div>';
      });

      const allRows = [...sysUnread.length ? sysRows.slice(0, sysUnread.length) : [], ...bookingRows, ...sysRead.length ? sysRows.slice(sysUnread.length) : []];

      if (allRows.length === 0) {
        list.innerHTML = '<div style="padding:40px;text-align:center;color:var(--bark-light);font-size:14px">No notifications yet.</div>';
      } else {
        list.innerHTML = allRows.join('');
      }
    }
  } else {
    // Owner view — system notifications from /api/notifications
    if (list) {
      if (!notifOwnerMessages || notifOwnerMessages.length === 0) {
        list.innerHTML = '<div style="padding:40px;text-align:center;color:var(--bark-light);font-size:14px">No notifications yet.</div>';
      } else {
        list.innerHTML = notifOwnerMessages.map(n => {
          const unread = !n.read;
          const icon = n.type === 'booking_declined' ? '❌' : n.type === 'service_application' ? '📋' : '🔔';
          return '<div class="menu-item" style="' + (unread ? 'border-left:3px solid var(--terra);' : 'opacity:0.75;') + '" onclick="handleOwnerNotifClick(' + n.id + ')">' +
            '<span class="menu-icon">' + icon + '</span>' +
            '<span class="menu-label" style="display:flex;flex-direction:column;gap:2px">' +
              '<span style="font-weight:600;font-size:14px">' + (n.title || 'Notification') + '</span>' +
              '<span style="font-size:12px;color:var(--bark-light);line-height:1.4">' + (n.message || '') + '</span>' +
            '</span>' +
            '<span class="menu-arrow">›</span>' +
          '</div>';
        }).join('');
      }
    }
  }
  show('notifications');
  currentScreen = 'notifications';
}

async function handleMinderNotifClick(id) {
  try { await api.markNotificationRead(id); } catch { /* silent */ }
  // Mark as read in local cache and refresh the badge + list
  const n = notifMinderMessages.find(x => x.id === id);
  if (n) n.read = true;
  loadNotificationCount();
  openNotifications();
}

async function deleteMinderNotif(id) {
  try {
    await api.deleteNotification(id);
    notifMinderMessages = notifMinderMessages.filter(n => n.id !== id);
    loadNotificationCount();
    openNotifications();
  } catch (err) {
    showToast('❌ ' + (err.message || 'Could not delete notification'));
  }
}

async function handleOwnerNotifClick(id) {
  try { await api.markNotificationRead(id); } catch { /* silent */ }
  // If this is a service_application notification and we're on admin page, open the panel
  const n = notifOwnerMessages.find(x => x.id === id);
  if (n && n.type === 'service_application' && n.applicantId) {
    if (typeof openAdminUserDetail === 'function') {
      const u = adminUsers.find(x => x.id === n.applicantId);
      if (u) { openAdminUserDetail(n.applicantId); return; }
    }
    window.location.href = 'admin.html';
    return;
  }
  window.location.href = 'bookings.html';
}

// Active booking page
async function initActiveBookingPage() {
  const params = new URLSearchParams(window.location.search);
  const minderId = params.get('minder') || 'sarah';

  // Resolve the minder from the real backend list first (numeric ids),
  // then fall back to the legacy hardcoded minderData (string keys). This
  // is what lets the booking carry the real name + profile picture instead
  // of the "Your Minder" / 🧑‍🦱 placeholder.
  let resolved = null;
  if (/^\d+$/.test(String(minderId))) {
    try {
      if (!loadedMinders || loadedMinders.length === 0) {
        loadedMinders = await api.getMinders();
      }
      const match = loadedMinders.find(x => String(x.id) === String(minderId));
      if (match) {
        resolved = {
          id:           match.id,
          name:         match.name || 'Minder',
          avatar:       '🧑‍🦱',              // emoji fallback for cards
          profileImage: match.profileImage || '' // real picture (data URI)
        };
      }
    } catch { /* silent — fall through to hardcoded */ }
  }
  if (!resolved) {
    resolved = { name: 'Your Minder', avatar: '🧑‍🦱', id: minderId, profileImage: '' };
  }

  window._activeMinder = resolved;
  const header = document.getElementById('booking-minder-name');
  if (header) header.textContent = 'Book ' + resolved.name;
  const summaryMinder = document.getElementById('summary-minder');
  if (summaryMinder) summaryMinder.textContent = resolved.name;
  generateDateChips();
  renderBookingPetPicker();
  updateBookingSummary();
  await refreshBookingTimeAvailability();
}

// Render the pet picker on the active-booking page from the logged-in
// user's own petData. Falls back to a helpful empty state if the user
// has no pets yet.
function renderBookingPetPicker() {
  const list = document.getElementById('booking-pet-list');
  if (!list) return;
  const ids = Object.keys(petData);
  if (ids.length === 0) {
    list.innerHTML = '<div style="padding:16px;background:var(--sand-light);border-radius:var(--radius-sm);font-size:13px;color:var(--bark-light);text-align:center">You haven\'t added any pets yet. Add one from your profile to book.</div>';
    selectedPets = [];
    return;
  }
  list.innerHTML = '';
  selectedPets = [ids[0]];
  ids.forEach((id, i) => {
    const p = petData[id];
    const row = document.createElement('div');
    row.className = 'pet-select-option' + (i === 0 ? ' selected' : '');
    row.onclick = function() { togglePetSelect(this, id); };
    const opacity = i === 0 ? '1' : '0.3';
    row.innerHTML =
      '<span class="service-icon">' + (p.emoji || '🐾') + '</span>' +
      '<div class="service-info"><div class="service-name">' + p.name + '</div><div class="service-desc">' + (p.breed || p.type || '') + '</div></div>' +
      '<span style="font-size:18px;opacity:' + opacity + '" class="pet-check">✓</span>';
    list.appendChild(row);
  });
}

const BOOKING_TIME_SLOTS = ['08:00','09:00','10:00','11:00','12:00','13:00','14:00','15:00','16:00','17:00','18:00','19:00','20:00'];

function getSelectedBookingDate() {
  const dateEl = document.querySelector('.date-chip.selected');
  const today = new Date();
  const monthNums = { Jan:1, Feb:2, Mar:3, Apr:4, May:5, Jun:6, Jul:7, Aug:8, Sep:9, Oct:10, Nov:11, Dec:12 };
  const day = dateEl ? (dateEl.dataset.day || String(today.getDate()).padStart(2,'0')) : String(today.getDate()).padStart(2,'0');
  const month = dateEl ? (dateEl.dataset.month || ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][today.getMonth()]) : ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][today.getMonth()];
  const year = today.getFullYear();
  return `${year}-${String(monthNums[month] || today.getMonth() + 1).padStart(2,'0')}-${day}`;
}

// Returns the set of time slots that must be marked unavailable on the
// active-booking page. A slot is unavailable in exactly two cases:
//
//  1. SAME-PET: one of the currently-selected pets already has a
//     non-cancelled booking at (bookingDate, slot). Different pets on the
//     same account can still share the same slot.
//  2. SAME-MINDER-ACCEPTED: this specific minder already has a confirmed
//     booking at (bookingDate, slot) with anyone. Pending requests from
//     other users do NOT block the slot — only an already-accepted one.
//
// Both checks are scoped to the date, so slots on other dates are never
// affected. This replaces the previous logic which treated every slot the
// user had any booking at as globally blocked.
function getUnavailableTimes(myBookings, minderTaken, bookingDate, minderAvailability) {
  const unavailable = new Set();

  // (2) Minder already confirmed at this date/slot (comes from the public
  // /bookings/minder/:id/taken endpoint — see refreshBookingTimeAvailability)
  if (Array.isArray(minderTaken)) minderTaken.forEach(t => unavailable.add(t));

  // (1) Currently-selected pets already booked at this date/slot
  const selected = (selectedPets || []).map(String);
  if (selected.length && Array.isArray(myBookings)) {
    myBookings.forEach(b => {
      if (b.bookingDate !== bookingDate) return;
      if (b.status === 'cancelled' || b.status === 'declined') return;
      const ids = Array.isArray(b.petIds) ? b.petIds.map(String) : [];
      if (ids.some(id => selected.includes(id))) unavailable.add(b.bookingTime);
    });
  }

  // (3) Outside the minder's published per-day availability.
  // `minderAvailability` is { availability: { mon: [...], ... }, isReal } where
  // isReal=false skips the check (legacy demo minders).
  if (minderAvailability && minderAvailability.isReal) {
    const avail = (minderAvailability.availability && typeof minderAvailability.availability === 'object')
      ? minderAvailability.availability : {};
    const day = availDayForDate(bookingDate);
    const daySlots = (day && Array.isArray(avail[day])) ? avail[day] : [];
    const dayOff = !Object.keys(avail).length || !day || !daySlots.length;
    BOOKING_TIME_SLOTS.forEach(t => {
      if (dayOff) { unavailable.add(t); return; }
      const slot = availSlotForTime(t);
      if (!slot || !daySlots.includes(slot)) unavailable.add(t);
    });
  }

  return unavailable;
}

function renderBookingTimeGrid(myBookings, minderTaken, minderAvailability) {
  const container = document.querySelector('.time-grid');
  if (!container) return;

  const bookingDate = getSelectedBookingDate();
  const unavailableTimes = getUnavailableTimes(myBookings, minderTaken, bookingDate, minderAvailability);
  const currentSelected = document.querySelector('.time-chip.selected')?.textContent.trim();
  const selectedIsUnavailable = currentSelected && unavailableTimes.has(currentSelected);

  container.innerHTML = BOOKING_TIME_SLOTS.map((slot, index) => {
    const unavailable = unavailableTimes.has(slot);
    const isSelected = (!currentSelected && !unavailable && index === 0) || (currentSelected === slot && !unavailable);
    const classes = ['time-chip'];
    if (isSelected) classes.push('selected');
    if (unavailable) classes.push('unavailable');
    return `<div class="${classes.join(' ')}"${unavailable ? '' : ' onclick="selectTime(this)"'}>${slot}</div>`;
  }).join('');

  if (selectedIsUnavailable) {
    const firstAvailable = container.querySelector('.time-chip:not(.unavailable)');
    if (firstAvailable) {
      container.querySelectorAll('.time-chip').forEach(t => t.classList.remove('selected'));
      firstAvailable.classList.add('selected');
      updateBookingSummary();
    }
  }
}

async function refreshBookingTimeAvailability() {
  const container = document.querySelector('.time-grid');
  if (!container) return;
  const bookingDate = getSelectedBookingDate();
  const minderId    = (window._activeMinder && window._activeMinder.id) || '';
  let myBookings = [];
  let minderTaken = [];
  let minderAvailability = { isReal: false, availability: {} };
  try {
    myBookings = await api.getBookings();
    allBookingsCache = myBookings;
  } catch { /* silent — treat as empty */ }
  // Only real (backend) minders have a numeric id; legacy hardcoded keys
  // like 'sarah' won't resolve on the server, so skip the taken-times call
  // for those and fall back to pet-only checks.
  if (minderId && /^\d+$/.test(String(minderId))) {
    try {
      const data = await api.getMinderTakenTimes(minderId, bookingDate);
      minderTaken = Array.isArray(data.taken) ? data.taken : [];
      minderAvailability = {
        isReal:       true,
        availability: (data.availability && typeof data.availability === 'object') ? data.availability : {}
      };
    } catch { /* silent */ }
  }
  renderBookingTimeGrid(myBookings, minderTaken, minderAvailability);
}

function generateDateChips() {
  const container = document.querySelector('.date-grid');
  if (!container) return;
  const dayNames = ['SUN','MON','TUE','WED','THU','FRI','SAT'];
  const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const today = new Date();
  container.innerHTML = '';
  for (let i = 0; i < 7; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    const chip = document.createElement('div');
    chip.className = 'date-chip' + (i === 0 ? ' selected' : '');
    chip.dataset.day = String(d.getDate()).padStart(2, '0');
    chip.dataset.month = monthNames[d.getMonth()];
    chip.dataset.dayName = dayNames[d.getDay()];
    chip.innerHTML = `<div class="day-name">${dayNames[d.getDay()]}</div><div class="day-num">${d.getDate()}</div>`;
    chip.onclick = function() { selectDate(this); };
    container.appendChild(chip);
  }
}

// All users for report search
const allUsers = [
  { name: 'Sarah K.', role: 'Pet Minder' }, { name: 'James M.', role: 'Pet Minder' },
  { name: 'Emma T.', role: 'Pet Minder' }, { name: 'Priya S.', role: 'Pet Minder' },
  { name: 'Tom H.', role: 'Pet Owner' }, { name: 'Priya L.', role: 'Pet Owner' }
];

// Admin data — fetched from the backend on the admin page.
// These arrays are populated by loadAdminData() and are never hardcoded.
let adminUsers    = [];
let adminDisputes = [];

// Chat data
let activeChat = null;
let selectedPets = [];

// Pet data — per-user, hydrated from the current user's namespaced
// localStorage key. New accounts start with an empty object; no cross-account
// leakage is possible because `store.getPets()` reads from
// `pawpal_pets_<currentUserId>`.
let petData = {};
(function initPetsFromCache() {
  const saved = store.getPets();
  if (saved && typeof saved === 'object') petData = saved;
}());
const petEmojis = { Dog: '🐕', Cat: '🐈', Rabbit: '🐇', Bird: '🐦', Other: '🐾' };

// ===== SCREEN SWITCHING =====
function show(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const screen = document.getElementById('screen-' + id);
  screen.classList.add('active');
  window.scrollTo(0, 0);
  const pc = screen.querySelector('.page-content');
  if (pc) pc.scrollTop = 0;
  const nav = document.getElementById('app-nav');
  const mh = document.getElementById('mobile-header');
  const isApp = appScreens.includes(id);
  if (nav) nav.classList.toggle('hidden', !isApp);
  if (mh) mh.style.display = isApp ? '' : 'none';
  if (id === 'messages') {
    document.getElementById('messages-container').classList.remove('chat-open');
    document.getElementById('chat-empty-state').style.display = 'flex';
    document.getElementById('chat-active-area').style.display = 'none';
    document.querySelectorAll('.chat-item').forEach(c => c.classList.remove('active-chat'));
    activeChat = null;
  }
  if (id === 'bookings') {
    // Force upcoming tab active
    const upTab = document.getElementById('bookings-tab-upcoming');
    const pastTab = document.getElementById('bookings-tab-past');
    const reqTab = document.getElementById('bookings-tab-requests');
    upTab.classList.add('active');
    pastTab.classList.remove('active');
    if (reqTab) reqTab.classList.remove('active');
    document.getElementById('bookings-upcoming').style.display = 'block';
    document.getElementById('bookings-past').style.display = 'none';
    const reqSection = document.getElementById('bookings-requests');
    if (reqSection) reqSection.style.display = 'none';
  }

  if (id === 'booking') {
    refreshBookingTimeAvailability();
  }
}

// ===== AUTH =====
function toggleAdminLogin() {
  const s = document.getElementById('admin-login-section');
  s.style.display = s.style.display === 'none' ? 'block' : 'none';
}

async function handleLogin() {
  const email = document.getElementById('login-email').value.trim();
  const pwd   = document.getElementById('login-password').value;
  if (!email || !pwd) { showToast('❌ Please enter your email and password'); return; }
  try {
    const { token, user } = await api.login(email, pwd);
    api.setToken(token);
    // store.setUser MUST run before any store.getPets/setPets call, because
    // the pets key is namespaced by the current user's id.
    store.setUser(user);
    hydrateUserProfile(user);
    // Pets are now fetched from the backend by the auth guard on the next
    // page load (so they follow the user across devices). We still reset
    // the in-memory object here in case any pre-redirect render fires.
    petData = {};
    isAdmin = Array.isArray(user.role) ? user.role.includes('admin') : user.role === 'admin';
    if (isAdmin) { window.location.href = 'admin.html'; } else { goToHome(); }
  } catch (err) {
    showToast('❌ ' + err.message);
  }
}

async function handleAdminLogin() {
  const email = document.getElementById('admin-username').value.trim();
  const pwd   = document.getElementById('admin-password').value.trim();
  if (!email || !pwd) { showToast('❌ Enter admin credentials'); return; }
  try {
    const { token, user } = await api.login(email, pwd);
    const roles = Array.isArray(user.role) ? user.role : [user.role];
    if (!roles.includes('admin')) { showToast('❌ This account is not an admin'); return; }
    api.setToken(token);
    store.setUser(user);
    isAdmin = true;
    window.location.href = 'admin.html';
  } catch {
    showToast('❌ Invalid admin credentials');
  }
}

// ===== FORGOT PASSWORD FLOW =====
let resetEmail = '';
let resetCode  = '';

function showForgotPassword() {
  document.getElementById('form-login').classList.add('hidden');
  document.getElementById('form-register').classList.add('hidden');
  document.getElementById('form-forgot').classList.remove('hidden');
  document.querySelector('.auth-tabs').style.display = 'none';
  showResetStep(1);
}

function closeForgotPassword() {
  document.getElementById('form-forgot').classList.add('hidden');
  document.getElementById('form-login').classList.remove('hidden');
  document.querySelector('.auth-tabs').style.display = 'flex';
  resetEmail = '';
  resetCode = '';
}

function showResetStep(n) {
  for (let i = 1; i <= 4; i++) {
    const el = document.getElementById('reset-step-' + i);
    if (el) el.style.display = i === n ? 'flex' : 'none';
  }
  // Update progress dots
  document.querySelectorAll('.reset-dot').forEach((d, idx) => {
    d.classList.toggle('active', idx < n);
  });
}

async function resetStepEmail() {
  const email = document.getElementById('reset-email').value.trim();
  if (!email) { showToast('❌ Please enter your email'); return; }
  try {
    const data = await api.forgotPassword(email);
    resetEmail = data.email;
    resetCode  = data.code;
    // Show the code in UI and console for testing
    const codeMsg = document.getElementById('reset-code-display');
    if (codeMsg) {
      codeMsg.textContent = 'Your verification code: ' + resetCode;
      codeMsg.style.display = 'block';
    }
    console.log('[PawPal] Password reset code for ' + resetEmail + ': ' + resetCode);
    showResetStep(2);
  } catch (err) {
    showToast('❌ ' + (err.message || 'Account not found'));
  }
}

function resetStepVerify() {
  const entered = document.getElementById('reset-code-input').value.trim();
  if (!entered) { showToast('❌ Please enter the verification code'); return; }
  if (entered !== resetCode) {
    showToast('❌ Incorrect verification code');
    document.getElementById('reset-code-input').style.borderColor = '#e53935';
    return;
  }
  document.getElementById('reset-code-input').style.borderColor = 'var(--sand)';
  showResetStep(3);
}

async function resetStepNewPassword() {
  const pwd     = document.getElementById('reset-new-password').value;
  const confirm = document.getElementById('reset-confirm-password').value;
  if (!pwd || !confirm) { showToast('❌ Please fill in both fields'); return; }
  if (pwd.length < 8) { showToast('❌ Password must be at least 8 characters'); return; }
  if (pwd !== confirm) {
    showToast('❌ Passwords do not match');
    document.getElementById('reset-confirm-password').style.borderColor = '#e53935';
    return;
  }
  try {
    await api.resetPassword(resetEmail, resetCode, pwd);
    showResetStep(4);
  } catch (err) {
    showToast('❌ ' + (err.message || 'Reset failed'));
  }
}

function resetComplete() {
  resetEmail = '';
  resetCode  = '';
  closeForgotPassword();
  showToast('✅ Password reset! Please log in.');
}

async function handleRegister() {
  const showRegError = (msg) => {
    showToast('❌ ' + msg);
  };

  const firstName = document.getElementById('reg-first-name').value.trim();
  const lastName  = document.getElementById('reg-last-name').value.trim();
  const email     = document.getElementById('reg-email').value.trim();
  const pwd       = document.getElementById('reg-password').value;
  const confirm   = document.getElementById('reg-confirm-password').value;
  let pMin, pMax;
  if (selectedRole === 'minder') {
    pMin = document.getElementById('bm-price-min').value;
    pMax = document.getElementById('bm-price-max').value;
  }

  if (!firstName || !lastName || !email) { showRegError('Please fill in all fields'); return; }
  if (pwd !== confirm) {
    showRegError('Passwords do not match');
    document.getElementById('reg-confirm-password').style.borderColor = 'var(--terra)';
    return;
  }
  document.getElementById('reg-confirm-password').style.borderColor = 'var(--sand)';

  // Owners must add at least one pet before registering
  if (selectedRole === 'owner' && regPendingPets.length === 0) {
    showRegError('Please add at least one pet to create an owner account');
    const petBox = document.querySelector('#reg-owner-extras .reg-extras-box');
    if (petBox) {
      petBox.style.outline = '2px solid var(--terra)';
      petBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setTimeout(() => { petBox.style.outline = ''; }, 2500);
    }
    return;
  }

  try {
    const payload = { firstName, lastName, email, password: pwd, role: selectedRole };
    if (selectedRole === 'minder') {
      payload.priceMin = pMin;
      payload.priceMax = pMax;
    }
    const { token, user } = await api.signup(payload);
    api.setToken(token);
    store.setUser(user);
    hydrateUserProfile(user);

    // For owners: create the pending pets on the backend now that we have a user
    if (selectedRole === 'owner' && regPendingPets.length > 0) {
      await Promise.all(regPendingPets.map(p => api.createPet(p).catch(() => {})));
      regPendingPets = [];
    }

    goToHome();
  } catch (err) {
    showRegError(err.message || 'Could not create account');
  }
}

function goToAuth() { window.location.href = 'auth.html'; }

function switchAuthTab(tab) {
  document.querySelectorAll('#screen-auth .auth-tab').forEach(t => t.classList.remove('active'));
  event.target.classList.add('active');
  document.getElementById('form-login').classList.toggle('hidden', tab === 'register');
  document.getElementById('form-register').classList.toggle('hidden', tab === 'login');
}

function selectRole(el, role) {
  document.querySelectorAll('.role-btn').forEach(b => b.classList.remove('selected'));
  el.classList.add('selected');
  selectedRole = role;
  const ownerExtras  = document.getElementById('reg-owner-extras');
  const minderExtras = document.getElementById('reg-minder-extras');
  const priceEl      = document.getElementById('bm-minder-price');
  if (ownerExtras)  ownerExtras.style.display  = role === 'owner'  ? 'block' : 'none';
  if (minderExtras) minderExtras.style.display = role === 'minder' ? 'block' : 'none';
  if (priceEl)      priceEl.style.display      = role === 'minder' ? 'block' : 'none';
}


// ===== BECOME A MINDER =====
const BM_ALL_SERVICES = [
  { name: 'Walking',  icon: '🚶', desc: '1 hour walk',   basic: true  },
  { name: 'Home Visit',   icon: '🏠', desc: '30 min check-in',     basic: true  },
];
let _bmHasQuals = false;

function openBecomeMinder() {
  _bmHasQuals = false;
  document.getElementById('bm-step-1').style.display       = 'block';
  document.getElementById('bm-step-quals').style.display   = 'none';
  document.getElementById('bm-step-services').style.display = 'none';
  document.getElementById('become-minder-modal').classList.add('open');
}
function closeBecomeMinder() {
  document.getElementById('become-minder-modal').classList.remove('open');
}

let _qualsSelectedFile = null; // staged file before submit

function openQualifications() {
  const modal = document.getElementById('quals-modal');
  if (!modal) return;
  modal.classList.add('open');
  renderQualsModalGrid();
  _qualsSelectedFile = null;
  const inp = document.getElementById('quals-file-input');
  const status = document.getElementById('quals-upload-status');
  if (inp) inp.value = '';
  if (status) status.textContent = '';
  // Reset service checkboxes
  document.querySelectorAll('#quals-service-checkboxes input[type="checkbox"]').forEach(cb => { cb.checked = false; });
}

function closeQualsModal() {
  const modal = document.getElementById('quals-modal');
  if (modal) modal.classList.remove('open');
  // Clear staged file and inputs
  _qualsSelectedFile = null;
  const inp = document.getElementById('quals-file-input');
  const status = document.getElementById('quals-upload-status');
  if (inp) inp.value = '';
  if (status) status.textContent = '';
  document.querySelectorAll('#quals-service-checkboxes input[type="checkbox"]').forEach(cb => { cb.checked = false; });
}

function renderQualsModalGrid() {
  const grid = document.getElementById('quals-modal-grid');
  if (!grid) return;
  const quals = userProfile.qualificationImages || [];
  if (quals.length === 0) {
    grid.innerHTML = '';
    return;
  }
  grid.innerHTML =
    '<p style="font-size:12px;font-weight:600;color:var(--bark-light);text-transform:uppercase;letter-spacing:0.5px;width:100%;margin-bottom:4px">Previously Uploaded</p>' +
    quals.map(q =>
      '<div style="position:relative;width:calc(50% - 5px)">' +
        '<img src="' + q.image + '" alt="Qualification" style="width:100%;max-height:120px;object-fit:contain;border-radius:8px;border:1.5px solid var(--sand-light);cursor:zoom-in" onclick="event.stopPropagation();previewQualImage(\'' + q.id + '\')">' +
        '<button onclick="deleteMyQual(\'' + q.id + '\')" style="position:absolute;top:4px;right:4px;background:rgba(0,0,0,0.6);color:white;border:none;border-radius:50%;width:24px;height:24px;font-size:14px;cursor:pointer;display:flex;align-items:center;justify-content:center;line-height:1" title="Remove">×</button>' +
      '</div>'
    ).join('');
}

function handleQualsFileSelect(input) {
  const file = input.files && input.files[0];
  const status = document.getElementById('quals-upload-status');
  if (!file) { _qualsSelectedFile = null; return; }
  if (file.type !== 'image/png') {
    showToast('❌ Only PNG images are accepted');
    input.value = '';
    _qualsSelectedFile = null;
    if (status) status.textContent = '';
    return;
  }
  if (file.size > 3 * 1024 * 1024) {
    showToast('❌ Image must be under 3 MB');
    input.value = '';
    _qualsSelectedFile = null;
    if (status) status.textContent = '';
    return;
  }
  _qualsSelectedFile = file;
  if (status) status.textContent = '✅ ' + file.name;
}

async function submitQualUpload() {
  if (!_qualsSelectedFile) {
    showToast('❌ Please choose a PNG image first');
    return;
  }
  const selected = Array.from(document.querySelectorAll('#quals-service-checkboxes input[type="checkbox"]:checked'))
    .map(cb => cb.value);
  if (selected.length === 0) {
    showToast('❌ Please select at least one service to apply for');
    return;
  }

  const status = document.getElementById('quals-upload-status');
  if (status) status.textContent = '⏳ Uploading…';

  try {
    const dataUri = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload  = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsDataURL(_qualsSelectedFile);
    });

    await Promise.all([
      api.uploadQualification(dataUri).then(result => {
        userProfile.qualificationImages = [
          ...(userProfile.qualificationImages || []),
          { id: result.id, image: dataUri, uploadedAt: result.uploadedAt }
        ];
      }),
      api.applyForServices(selected)
    ]);

    closeQualsModal();
    showToast('📨 Qualification uploaded! Admin will review your application.');
  } catch (err) {
    if (status) status.textContent = '';
    showToast('❌ ' + (err.message || 'Upload failed'));
  }
}

function previewQualImage(qualId) {
  const qual = (userProfile.qualificationImages || []).find(q => q.id === qualId);
  if (qual) openImagePreview(qual.image);
}

async function deleteMyQual(imageId) {
  try {
    await api.deleteQualification(imageId);
    userProfile.qualificationImages = (userProfile.qualificationImages || []).filter(q => q.id !== imageId);
    renderQualsModalGrid();
    showToast('✅ Qualification removed');
  } catch (err) {
    showToast('❌ ' + (err.message || 'Could not remove qualification'));
  }
}

async function bmSubmitQuals() {
  const fileInput = document.getElementById('bm-cert-input');
  const file = fileInput && fileInput.files && fileInput.files[0];

  if (!file) { showToast('❌ Please upload a PNG of your qualification'); return; }
  if (file.type !== 'image/png') { showToast('❌ Only PNG images are accepted'); return; }
  if (file.size > 3 * 1024 * 1024) { showToast('❌ Image must be under 3 MB'); return; }

  const selected = Array.from(document.querySelectorAll('#qual-service-checkboxes input[type="checkbox"]:checked'))
    .map(cb => cb.value);
  if (selected.length === 0) { showToast('❌ Please select at least one service to apply for'); return; }

  try {
    const dataUri = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload  = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsDataURL(file);
    });

    await Promise.all([
      api.applyForServices(selected),
      api.uploadQualification(dataUri)
    ]);

    // Refresh profile — the backend may have auto-granted the minder role
    try {
      const refreshed = await api.getMe();
      hydrateUserProfile(refreshed);
      store.setUser(userProfile);
    } catch { /* non-fatal */ }

    closeBecomeMinder();
    showToast('📨 Qualification uploaded! Admin will review your application.');
  } catch (err) {
    showToast('❌ ' + (err.message || 'Could not submit application'));
  }
}

function bmShowStep2(hasQuals) {
  _bmHasQuals = hasQuals;
  document.getElementById('bm-step-1').style.display = 'none';
  if (hasQuals) {
    document.getElementById('bm-cert-names').textContent = '';
    document.getElementById('bm-cert-input').value = '';
    document.getElementById('bm-step-quals').style.display   = 'block';
    document.getElementById('bm-step-services').style.display = 'none';
  } else {
    bmShowStep3();
  }
}

function bmHandleCerts() {
  const input = document.getElementById('bm-cert-input');
  const file = input.files && input.files[0];
  if (!file) return;
  if (file.type !== 'image/png') {
    showToast('❌ Only PNG images are accepted');
    input.value = '';
    document.getElementById('bm-cert-names').textContent = '';
    return;
  }
  if (file.size > 3 * 1024 * 1024) {
    showToast('❌ Image must be under 3 MB');
    input.value = '';
    document.getElementById('bm-cert-names').textContent = '';
    return;
  }
  document.getElementById('bm-cert-names').textContent = '✅ ' + file.name;
}

function bmShowStep3() {
  document.getElementById('bm-step-quals').style.display    = 'none';
  document.getElementById('bm-step-services').style.display = 'block';

  // Always show only basic services — Grooming, Vet, Training are admin-enabled only.
  const available = BM_ALL_SERVICES.filter(s => s.basic);
  const hint = document.getElementById('bm-services-hint');
  const prev = document.getElementById('bm-back-btn');
  hint.textContent = _bmHasQuals
    ? 'Thank you! We will review your qualifications and may enable additional services once approved.'
    : 'You can offer these services straight away. Additional services can be unlocked by uploading relevant qualifications.';

  prev.onclick = _bmHasQuals ? function() { bmShowStep2(true); } : function() { openBecomeMinder(); };

  services = available.map(s => s.name); // pre-select all basic services
  const container = document.getElementById('bm-service-options');
  container.innerHTML = '';
  available.forEach(s => {
    const opt = document.createElement('div');
    opt.className = 'service-option selected';
    opt.style.cursor = 'pointer';
    opt.dataset.service = s.name;
    opt.innerHTML =
      '<span class="service-icon">' + s.icon + '</span>' +
      '<div class="service-info"><div class="service-name">' + s.name + '</div><div class="service-desc">' + s.desc + '</div></div>' +
      '<span style="font-size:18px" class="bm-check">✓</span>';
    opt.onclick = function() { bmToggleService(this, s.name); };
    container.appendChild(opt);
  });

  // Reset price fields to sensible defaults
  const pMin = document.getElementById('bm-price-min');
  const pMax = document.getElementById('bm-price-max');
  if (pMin && !pMin.value) pMin.value = 10;
  if (pMax && !pMax.value) pMax.value = 50;
}

function bmToggleService(el, name) {
  const isSelected = el.classList.contains('selected');
  el.classList.toggle('selected');
  el.querySelector('.bm-check').style.opacity = el.classList.contains('selected') ? '1' : '0.2';
  if (el.classList.contains('selected')) { if (!services.includes(name)) services.push(name); }
  else { services = services.filter(n => n !== name); }
}

async function bmConfirm() {
  if (services.length === 0) { showToast('❌ Please select at least one service'); return; }
  const pMinEl = document.getElementById('bm-price-min');
  const pMaxEl = document.getElementById('bm-price-max');
  const priceMin = pMinEl ? Math.max(1, Math.min(100, Number(pMinEl.value) || 10)) : 10;
  const priceMax = pMaxEl ? Math.max(1, Math.min(100, Number(pMaxEl.value) || 25)) : 25;
  try {
    const saved = await api.updateMe({
      addMinderRole: true,
      services: services.join(', '),
      priceMin,
      priceMax,
    });
    hydrateUserProfile(saved);
    store.setUser(userProfile);
    closeBecomeMinder();
    renderProfileAvatar();
    refreshPetsUI();
    showToast('🎉 You are now a Pet Minder!');
  } catch (err) {
    showToast('❌ ' + (err.message || 'Something went wrong'));
  }
}

// ===== MINDER AVAILABILITY TOGGLE =====
async function toggleMinderAvailability() {
  const newVal = !userProfile.availableForBooking;
  try {
    const saved = await api.setAvailability(newVal);
    hydrateUserProfile(saved);
    store.setUser(userProfile);
    renderProfileAvatar();
    showToast(newVal ? '✅ You are now visible to pet owners' : '🌴 You are now hidden from Find Minders');
  } catch (err) {
    showToast('❌ ' + (err.message || 'Could not update availability'));
  }
}

// ===== NAVIGATION =====
function goToSearch() {
  const roles = Array.isArray(userProfile.role) ? userProfile.role : [userProfile.role || ''];
  if (!roles.includes('owner')) {
    showToast('❌ Find Minders is not available for non-owners');
    return;
  }
  window.location.href = 'search.html';
}

function goToHome() { window.location.href = 'home.html'; }
function switchTab(tab) {
  const pageMap = { home: 'home.html', search: 'search.html', bookings: 'bookings.html', messages: 'messages.html', profile: 'profile.html' };
  if (pageMap[tab]) window.location.href = pageMap[tab];
}

function setNavActive(tab) {
  document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
  const n = document.getElementById('nav-' + tab);
  if (n) n.classList.add('active');
  document.querySelectorAll('.bottom-nav').forEach(nav => {
    nav.querySelectorAll('.bottom-nav-item').forEach((btn, i) => {
      btn.classList.toggle('active', ['home','search','bookings','messages','profile'][i] === tab);
    });
  });
}

// ===== AVATAR HELPER =====
// Returns an <img> tag if profileImage exists, otherwise the emoji fallback.
function avatarHTML(profileImage, fallbackEmoji, sizeClass) {
  if (profileImage) {
    return '<img src="' + profileImage + '" alt="avatar" class="avatar-img ' + (sizeClass || '') + '">';
  }
  return fallbackEmoji || '👤';
}

// ===== PROFILE AVATAR =====
// Limits (must match backend)
const AVATAR_MAX_SIZE  = 2 * 1024 * 1024; // 2 MB
const AVATAR_MAX_DIM   = 1024;            // px
const AVATAR_MIME_OK   = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

function renderProfileAvatar() {
  const el = document.getElementById('profile-avatar-display');
  const toggleIcon = document.getElementById('availability-icon');
  if (!el) return;
  if (userProfile.profileImage) {
    el.innerHTML = '<img src="' + userProfile.profileImage + '" alt="avatar" class="avatar-img avatar-profile">';
  } else {
    el.textContent = '👤';
  }
  // Update the role line
  const roles = Array.isArray(userProfile.role) ? userProfile.role : [userProfile.role];
  const isMinder = roles.includes('minder');
  const isOwner  = roles.includes('owner');
  const roleEl = document.getElementById('profile-display-role');
  if (roleEl) {
    let label = 'Pet Owner';
    if (isMinder && isOwner) label = 'Pet Owner & Minder';
    else if (isMinder)       label = 'Pet Minder';
    roleEl.textContent = label;
  }
  // Show "Become a Minder" only for owners who aren't yet minders
  const bmItem = document.getElementById('become-minder-item');
  if (bmItem) bmItem.style.display = (isOwner && !isMinder) ? 'flex' : 'none';

  // Show qualifications upload only for minders
  const qualItem = document.getElementById('upload-quals-item');
  if (qualItem) qualItem.style.display = isMinder ? 'flex' : 'none';
  const payoutItem = document.getElementById('payout-item');
  if (payoutItem) payoutItem.style.display = isMinder ? 'flex' : 'none';

  // Availability toggle — only visible to minders
  const availRow = document.getElementById('minder-availability-item');
  if (availRow) {
    availRow.style.display = isMinder ? 'flex' : 'none';
    const toggle = document.getElementById('availability-toggle');
    const toggleLabel = document.getElementById('availability-label');
    if (toggle) toggle.checked = userProfile.availableForBooking !== false;
    if (toggleLabel) {
      toggleLabel.textContent = userProfile.availableForBooking !== false
        ? 'Available for bookings'
        : 'Not taking bookings';
      toggleIcon.textContent =  userProfile.availableForBooking !== false ? '🏠' : '🌴';
      toggleLabel.style.color = userProfile.availableForBooking !== false
        ? 'var(--bark)'
        : 'var(--bark-light)';
    }
  }
}

async function handleAvatarUpload(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;

  // Client-side validation
  if (!AVATAR_MIME_OK.includes(file.type)) {
    showToast('❌ Only JPEG, PNG, WebP, or GIF images are allowed');
    event.target.value = '';
    return;
  }
  if (file.size > AVATAR_MAX_SIZE) {
    showToast('❌ Image too large. Maximum 2 MB');
    event.target.value = '';
    return;
  }

  // Read as data URI, validate dimensions, then upload
  const reader = new FileReader();
  reader.onload = async function(e) {
    const dataURI = e.target.result;

    // Check dimensions
    const img = new Image();
    img.onload = async function() {
      if (img.width > AVATAR_MAX_DIM || img.height > AVATAR_MAX_DIM) {
        showToast('❌ Image too large. Maximum ' + AVATAR_MAX_DIM + 'x' + AVATAR_MAX_DIM + ' px');
        return;
      }
      // Upload to backend
      try {
        const { profileImage } = await api.uploadAvatar(dataURI);
        userProfile.profileImage = profileImage;
        store.setUser(userProfile);
        renderProfileAvatar();
        refreshPetsUI();
        showToast('✅ Profile picture updated!');
      } catch (err) {
        showToast('❌ ' + (err.message || 'Upload failed'));
      }
    };
    img.onerror = function() { showToast('❌ Could not read image'); };
    img.src = dataURI;
  };
  reader.readAsDataURL(file);
  event.target.value = ''; // reset so the same file can be re-selected
}

// ===== FIND MINDERS =====
// Cached array of minders loaded from the API (used by search + profile view).
let loadedMinders = [];
let userCoords = null;          // { lat, lng } once geolocation granted
const geocodeCache = {};        // locationString -> { lat, lng } | null

async function loadMinders() {
  const list = document.getElementById('minders-list');
  if (!list) return;

  // Only owners can browse minders
  const roles = Array.isArray(userProfile.role) ? userProfile.role : [userProfile.role || ''];
  if (!roles.includes('owner')) {
    showToast('❌ Find Minders is not available for non-owners');
    return;
  }
  try {
    loadedMinders = await api.getMinders();
    if (loadedMinders.length === 0) {
      list.innerHTML = '<div style="padding:40px;text-align:center;color:var(--bark-light);font-size:14px">No pet minders have signed up yet.</div>';
      return;
    }
    renderMinders(loadedMinders);
  } catch {
    list.innerHTML = '<div style="padding:40px;text-align:center;color:var(--bark-light);font-size:14px">Could not load minders. Try refreshing.</div>';
  }
}

function openMinderProfile(minderId) {
  if (minderId == null) return;
  window.location.href = 'minder.html?id=' + encodeURIComponent(minderId);
}

function openBooking() { previousScreen = currentScreen; show('booking'); currentScreen = 'booking'; }

function goBack() {
  if (previousScreen) { show(previousScreen); currentScreen = previousScreen; setNavActive(previousScreen); previousScreen = null; }
  else switchTab('home');
}

// ===== MESSAGES =====
async function messageMinder(otherUserId) {
  try {
    const chat = await api.createChat(Number(otherUserId));
    window.location.href = 'messages.html?chat=' + chat.id;
  } catch (err) {
    showToast('❌ ' + (err.message || 'Could not open chat'));
  }
}

async function openChatInline(chatId) {
  activeChat = Number(chatId);
  const chat = chatListCache.find(c => c.id === activeChat);
  renderChatList();
  document.getElementById('chat-empty-state').style.display = 'none';
  const area = document.getElementById('chat-active-area'); area.style.display = 'flex';
  const avatarEl = document.getElementById('chat-active-avatar');
  if (chat) {
    avatarEl.innerHTML = chatAvatarHTML(chat.other);
    document.getElementById('chat-active-name').textContent = chat.other.name || 'User';
  }
  const statusEl = document.getElementById('chat-active-status');
  const isOnline = !!(chat && chat.other && chat.other.online);
  statusEl.innerHTML = isOnline ? '● Online' : '● Offline';
  statusEl.style.color = isOnline ? '#4caf50' : '#9e9e9e';
  const msgs = document.getElementById('chat-active-messages');
  msgs.innerHTML = '<div style="color:var(--bark-light);font-size:13px;text-align:center">Loading…</div>';
  document.getElementById('messages-container').classList.add('chat-open');
  try {
    const history = await api.getChatMessages(activeChat);
    const myId = store.currentUserId();
    msgs.innerHTML = '';
    history.forEach(m => {
      const isMine = String(m.fromUserId) === String(myId);
      const b = document.createElement('div');
      b.className = 'msg-bubble ' + (isMine ? 'sent' : 'received');
      if (m.deleted) {
        b.innerHTML = '<span style="opacity:0.45;font-style:italic;font-size:12px">Message deleted</span><div class="msg-time">' + formatMsgTime(m.createdAt) + '</div>';
      } else {
        let content = '';
        if (m.image) content += '<img src="' + m.image + '" class="msg-image" alt="Photo" onclick="openImagePreview(this.src)">';
        if (m.text) content += escapeHTML(m.text);
        content += '<div class="msg-time">' + formatMsgTime(m.createdAt) + '</div>';
        if (isMine) {
          content += '<button class="msg-delete-btn" onclick="deleteMyMessage(' + activeChat + ',' + m.id + ',this.closest(\'.msg-bubble\'))" title="Delete message">×</button>';
        }
        b.innerHTML = content;
      }
      msgs.appendChild(b);
    });
    msgs.scrollTop = msgs.scrollHeight;
  } catch {
    msgs.innerHTML = '<div style="color:var(--bark-light);font-size:13px;text-align:center">Could not load messages.</div>';
  }
}
function closeMobileChat() { document.getElementById('messages-container').classList.remove('chat-open'); }

async function deleteMyMessage(chatId, msgId, bubbleEl) {
  try {
    await api.deleteMessage(chatId, msgId);
    if (bubbleEl) bubbleEl.innerHTML = '<span style="opacity:0.45;font-style:italic;font-size:12px">Message deleted</span>';
  } catch (err) {
    showToast('❌ ' + (err.message || 'Could not delete message'));
  }
}

function deleteChatForMe() {
  if (!activeChat) return;
  showConfirmModal('🗑', 'Delete conversation?', 'This will hide the conversation from your list. The other person can still see it.', async function() {
    try {
      await api.hideChat(activeChat);
      closeMobileChat();
      activeChat = null;
      await loadChatList();
      showToast('✅ Conversation removed');
    } catch (err) {
      showToast('❌ ' + (err.message || 'Could not delete conversation'));
    }
  });
}

async function sendMessage(imageDataUri) {
  const input = document.getElementById('chat-input-field');
  const text = (input ? input.value.trim() : '');
  if (!imageDataUri && !text) return;
  if (!activeChat) return;
  if (input) input.value = '';
  const msgs = document.getElementById('chat-active-messages');
  const b = document.createElement('div');
  b.className = 'msg-bubble sent';
  let preview = '';
  if (imageDataUri) preview += '<img src="' + imageDataUri + '" class="msg-image" alt="Photo">';
  if (text) preview += escapeHTML(text);
  preview += '<div class="msg-time">…</div>';
  b.innerHTML = preview;
  msgs.appendChild(b);
  msgs.scrollTop = msgs.scrollHeight;
  try {
    const saved = await api.sendChatMessage(activeChat, text || '', imageDataUri || '');
    let content = '';
    if (saved.image) content += '<img src="' + saved.image + '" class="msg-image" alt="Photo" onclick="openImagePreview(this.src)">';
    if (saved.text) content += escapeHTML(saved.text);
    content += '<div class="msg-time">' + formatMsgTime(saved.createdAt) + '</div>';
    content += '<button class="msg-delete-btn" onclick="deleteMyMessage(' + activeChat + ',' + saved.id + ',this.closest(\'.msg-bubble\'))" title="Delete message">×</button>';
    b.innerHTML = content;
    await loadChatList();
  } catch (err) {
    b.remove();
    showToast('❌ ' + (err.message || 'Failed to send'));
  }
}

function openChatImagePicker() {
  const picker = document.getElementById('chat-image-input');
  if (picker) picker.click();
}

function handleChatImageSelect(inputEl) {
  const file = inputEl.files && inputEl.files[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) { showToast('❌ Please select an image file'); inputEl.value = ''; return; }
  if (file.size > 2 * 1024 * 1024) { showToast('❌ Image must be under 2 MB'); inputEl.value = ''; return; }
  const reader = new FileReader();
  reader.onload = () => { sendMessage(reader.result); inputEl.value = ''; };
  reader.onerror = () => { showToast('❌ Failed to read image'); inputEl.value = ''; };
  reader.readAsDataURL(file);
}

function openImagePreview(src) {
  const overlay = document.getElementById('image-preview-overlay');
  const img = document.getElementById('image-preview-img');
  if (overlay && img) { img.src = src; overlay.style.display = 'flex'; }
}
function closeImagePreview() {
  const overlay = document.getElementById('image-preview-overlay');
  if (overlay) overlay.style.display = 'none';
}

const _chatInputField = document.getElementById('chat-input-field');
if (_chatInputField) _chatInputField.addEventListener('keydown', e => { if (e.key === 'Enter') sendMessage(); });

// ===== PROFILE TABS =====
function switchProfileTab(btn, tabId) {
  document.querySelectorAll('.profile-tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  document.querySelectorAll('[id^="tab-"]').forEach(t => t.classList.add('hidden'));
  document.getElementById(tabId).classList.remove('hidden');

  // Lazy-load reviews when the Reviews tab is opened
  if (tabId === 'tab-reviews' && currentReviewMinder) {
    const container = document.getElementById('minder-reviews-list');
    if (container && container.dataset.loaded !== 'done') {
      if (_cachedMinderReviews) {
        renderMinderReviews(_cachedMinderReviews.reviews);
      } else {
        container.dataset.loaded = 'pending';
        container.innerHTML = '<div style="padding:20px;text-align:center;color:var(--bark-light);font-size:13px">Loading reviews…</div>';
        api.getMinderReviews(currentReviewMinder).then(({ reviews, average, count }) => {
          _cachedMinderReviews = { reviews, average, count };
          renderMinderReviews(reviews);
        }).catch(() => {
          container.innerHTML = '<div style="padding:20px;text-align:center;color:var(--bark-light);font-size:13px">Could not load reviews.</div>';
        });
      }
    }
  }
}

// ===== BOOKINGS TABS =====
function switchBookingTab(btn, tab) {
  document.querySelectorAll('#screen-bookings .auth-tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('bookings-upcoming').style.display = tab === 'upcoming' ? 'block' : 'none';
  document.getElementById('bookings-past').style.display = tab === 'past' ? 'block' : 'none';
  const reqSection = document.getElementById('bookings-requests');
  if (reqSection) reqSection.style.display = tab === 'requests' ? 'block' : 'none';
  if (tab === 'requests') loadBookingRequests();
  // Show live GPS card only on upcoming tab
  const liveCard = document.getElementById('bookings-gps-live');
  if (liveCard && liveCard.dataset.hasLive === '1') liveCard.style.display = tab === 'upcoming' ? 'block' : 'none';
  // Load past routes when switching to past tab
  if (tab === 'past') {
    const routesSection = document.getElementById('bookings-past-routes');
    if (routesSection) { routesSection.style.display = 'block'; renderPastRoutes(); }
  }
}

// ===== BOOKING FLOW =====
function selectService(el) { el.closest('.service-list').querySelectorAll('.service-option').forEach(o => o.classList.remove('selected')); el.classList.add('selected'); updateBookingSummary(); }
async function selectDate(el) { document.querySelectorAll('.date-chip').forEach(d => d.classList.remove('selected')); el.classList.add('selected'); await refreshBookingTimeAvailability(); updateBookingSummary(); }
function selectTime(el) { if (el.classList.contains('unavailable')) return; document.querySelectorAll('.time-chip').forEach(t => t.classList.remove('selected')); el.classList.add('selected'); updateBookingSummary(); }
function toggleChip(el) { el.classList.toggle('active'); }
function toggleFilterModal() { document.getElementById('filter-modal').classList.toggle('open'); }

// ===== SEARCH & FILTER SYSTEM =====
// Saved filter state — only updated when user clicks Save or Clear All.
let savedFilters = { petTypes: [], serviceTypes: [], priceMin: null, priceMax: null, minRating: null, sortBy: null };

// Helper: read the text label from a filter-opt, strip its emoji prefix, return lowercase.
function filterOptLabel(el) { return el.textContent.replace(/^[^\w]*/u, '').trim().toLowerCase(); }

// Location search bar — triggered by the Go button or Enter key
// ===== DISTANCE / GEOCODING =====

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function geocodeLocation(locationStr) {
  if (!locationStr) return null;
  const key = locationStr.trim().toLowerCase();
  if (key in geocodeCache) return geocodeCache[key];
  try {
    const url = 'https://nominatim.openstreetmap.org/search?q=' +
                encodeURIComponent(locationStr + ', UK') +
                '&format=json&limit=1';
    const res = await fetch(url, { headers: { 'Accept-Language': 'en' } });
    const json = await res.json();
    const result = json[0] ? { lat: parseFloat(json[0].lat), lng: parseFloat(json[0].lon) } : null;
    geocodeCache[key] = result;
    return result;
  } catch {
    geocodeCache[key] = null;
    return null;
  }
}

async function requestUserLocation() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) { resolve(null); return; }
    navigator.geolocation.getCurrentPosition(
      pos => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      ()  => resolve(null),
      { timeout: 8000 }
    );
  });
}

function selectSortFilter(el) {
  const wasActive = el.classList.contains('active');
  document.querySelectorAll('#filter-sort .filter-opt').forEach(o => o.classList.remove('active'));
  if (!wasActive) el.classList.add('active');
}

// Keep the quick-sort chip bar and the filter-modal Sort By section in sync
function syncSortChips(sortBy) {
  // Quick chips bar
  document.querySelectorAll('.sort-chip').forEach(c => {
    c.classList.toggle('active', c.dataset.sort === sortBy);
  });
  // Filter modal
  document.querySelectorAll('#filter-sort .filter-opt').forEach(o => {
    o.classList.toggle('active', o.dataset.sort === sortBy);
  });
}

// Quick-sort chip clicked directly from the search page bar
async function quickSort(sortBy) {
  savedFilters.sortBy = (savedFilters.sortBy === sortBy) ? null : sortBy; // toggle off if same
  syncSortChips(savedFilters.sortBy);
  await runSearch();
}

function formatDist(km) {
  if (km == null) return '';
  return km < 1 ? Math.round(km * 1000) + ' m away' : km.toFixed(1) + ' km away';
}

function searchByLocation() {
  runSearch();
}


// Central search: combines the location bar + saved modal filters and re-renders.
async function runSearch() {
  const locInput = document.getElementById('search-location-input');
  const query = locInput ? locInput.value.trim().toLowerCase() : '';

  let filtered = loadedMinders.filter(m => {
    // 1. Location search
    if (query) {
      const minderLoc = (m.location || '').toLowerCase();
      if (!minderLoc.includes(query)) return false;
    }

    // 2. Pet type filter
    if (savedFilters.petTypes.length > 0) {
      if (!m.petsCaredFor) return false;
      const minderPets = m.petsCaredFor.split(',').map(s => s.trim().toLowerCase());
      if (!savedFilters.petTypes.some(p => minderPets.includes(p))) return false;
    }

    // 3. Service type filter
    if (savedFilters.serviceTypes.length > 0) {
      if (!m.services) return false;
      const minderSvcs = m.services.split(',').map(s => s.trim().toLowerCase());
      if (!savedFilters.serviceTypes.some(s => minderSvcs.includes(s))) return false;
    }

    // 4. Price range filter — minder's range must overlap with the user's range
    if (savedFilters.priceMin !== null && m.priceMax != null && m.priceMax < savedFilters.priceMin) return false;
    if (savedFilters.priceMax !== null && m.priceMin != null && m.priceMin > savedFilters.priceMax) return false;

    // 5. Minimum rating filter
    if (savedFilters.minRating !== null) {
      if (!m.avgRating || m.avgRating < savedFilters.minRating) return false;
    }

    return true;
  });

  // 5. Sorting
  if (savedFilters.sortBy === 'distance') {
    // Get user location if we don't have it yet
    if (!userCoords) {
      const list = document.getElementById('minders-list');
      if (list) list.innerHTML = '<div style="padding:40px;text-align:center;color:var(--bark-light);font-size:14px">📍 Getting your location…</div>';
      userCoords = await requestUserLocation();
      if (!userCoords) {
        showToast('❌ Location access denied – can\'t sort by distance');
        savedFilters.sortBy = null;
        document.querySelectorAll('#filter-sort .filter-opt').forEach(o => o.classList.remove('active'));
        renderMinders(filtered);
        return filtered;
      }
    }
    // Geocode any minder locations we haven't seen yet
    await Promise.all(filtered.map(m => geocodeLocation(m.location)));
    // Attach distance to each minder object (transient, not persisted)
    filtered.forEach(m => {
      const coords = m.location ? geocodeCache[(m.location).trim().toLowerCase()] : null;
      m._distKm = coords ? haversineKm(userCoords.lat, userCoords.lng, coords.lat, coords.lng) : null;
    });
    filtered.sort((a, b) => {
      if (a._distKm == null && b._distKm == null) return 0;
      if (a._distKm == null) return 1;
      if (b._distKm == null) return -1;
      return a._distKm - b._distKm;
    });
  } else if (savedFilters.sortBy === 'rating') {
    filtered.sort((a, b) => (b.avgRating || 0) - (a.avgRating || 0));
  } else if (savedFilters.sortBy === 'review_count') {
    filtered.sort((a, b) => (b.reviewCount || 0) - (a.reviewCount || 0));
  } else if (savedFilters.sortBy === 'price_asc') {
    filtered.sort((a, b) => (a.priceMin ?? Infinity) - (b.priceMin ?? Infinity));
  } else if (savedFilters.sortBy === 'price_desc') {
    filtered.sort((a, b) => (b.priceMax ?? -Infinity) - (a.priceMax ?? -Infinity));
  }

  renderMinders(filtered);
  return filtered;
}

// Clear All — reset modal UI, clear saved filters, re-run search (location still applies)
function clearAllFilters() {
  document.querySelectorAll('#filter-modal .filter-opt').forEach(o => o.classList.remove('active'));
  const minEl = document.getElementById('filter-price-min');
  const maxEl = document.getElementById('filter-price-max');
  if (minEl) minEl.value = '';
  if (maxEl) maxEl.value = '';
  savedFilters = { petTypes: [], serviceTypes: [], priceMin: null, priceMax: null, minRating: null, sortBy: null };
  syncSortChips(null);
  runSearch();
  toggleFilterModal();
  showToast('✅ Filters cleared');
}

// Save — read modal UI into savedFilters, then re-run search
async function applyFilters() {
  const petTypeEls = document.querySelectorAll('#filter-pet-type .filter-opt.active');
  savedFilters.petTypes = Array.from(petTypeEls).map(filterOptLabel);

  const serviceEls = document.querySelectorAll('#filter-service-type .filter-opt.active');
  savedFilters.serviceTypes = Array.from(serviceEls).map(filterOptLabel);

  const minEl = document.getElementById('filter-price-min');
  const maxEl = document.getElementById('filter-price-max');
  savedFilters.priceMin = minEl && minEl.value !== '' ? Number(minEl.value) : null;
  savedFilters.priceMax = maxEl && maxEl.value !== '' ? Number(maxEl.value) : null;

  const ratingEl = document.querySelector('#filter-rating .filter-opt.active');
  savedFilters.minRating = ratingEl ? Number(ratingEl.dataset.rating) : null;

  const sortEl = document.querySelector('#filter-sort .filter-opt.active');
  savedFilters.sortBy = sortEl ? sortEl.dataset.sort : null;
  syncSortChips(savedFilters.sortBy);

  toggleFilterModal();
  const filtered = await runSearch();
  showToast('✅ Filters saved – ' + filtered.length + ' minder' + (filtered.length !== 1 ? 's' : '') + ' found');
}

// Render a given list of minders into the minders-list container
function renderMinders(minders) {
  const list = document.getElementById('minders-list');
  if (!list) return;
  if (minders.length === 0) {
    list.innerHTML = '<div style="padding:40px;text-align:center;color:var(--bark-light);font-size:14px">No minders match your filters.</div>';
    return;
  }
  list.innerHTML = '';
  minders.forEach(m => {
    const avatar = m.profileImage
      ? '<img src="' + m.profileImage + '" alt="' + m.name + '" class="avatar-img" style="width:100%;height:100%;object-fit:cover;border-radius:14px">'
      : '👤';
    const loc  = m.location ? '📍 ' + m.location : '';
    const price = (m.priceMin != null && m.priceMax != null) ? '£' + m.priceMin + ' – £' + m.priceMax + '/hr' : (m.rate || '');
    const tags = [];
    if (m.services) m.services.split(',').forEach(s => { s = s.trim(); if (s) tags.push('<span class="tag">' + s + '</span>'); });
    if (m.petsCaredFor) m.petsCaredFor.split(',').forEach(s => { s = s.trim(); if (s) tags.push('<span class="tag">' + s + '</span>'); });

    // Distance badge shown when sorting by distance
    const distBadge = (savedFilters.sortBy === 'distance' && m._distKm != null)
      ? ' <span style="display:inline-block;font-size:11px;background:var(--sand-light);color:var(--bark);border-radius:20px;padding:2px 8px;font-weight:500">📍 ' + formatDist(m._distKm) + '</span>'
      : '';

    const card = document.createElement('div');
    card.className = 'minder-list-card';
    card.style.cursor = 'pointer';
    card.onclick = function() { openMinderProfile(m.id); };
    card.innerHTML =
      '<div class="minder-list-avatar">' + avatar + '</div>' +
      '<div class="minder-list-info">' +
        '<div class="minder-list-name" style="display:flex;align-items:center;flex-wrap:wrap;gap:4px">' + m.name + distBadge + '</div>' +
        (loc ? '<div class="minder-list-loc">' + loc + '</div>' : '') +
        (m.avgRating ? '<div style="font-size:12px;color:#f5a623;margin-top:2px">★ ' + m.avgRating + ' <span style="color:var(--bark-light)">(' + m.reviewCount + ' review' + (m.reviewCount !== 1 ? 's' : '') + ')</span></div>' : '') +
        (tags.length ? '<div class="minder-list-tags">' + tags.join('') + '</div>' : '') +
        (price ? '<div class="minder-list-rate">' + price + '</div>' : '') +
        '<div class="minder-btns">' +
          '<button class="btn-msg-minder" onclick="event.stopPropagation();messageMinder(' + m.id + ')">💬 Message</button>' +
          (String(m.id) === String(store.currentUserId())
            ? '<span style="font-size:12px;color:var(--bark-light);padding:10px 12px">Your listing</span>'
            : ((Array.isArray(userProfile.role) ? userProfile.role : [userProfile.role || '']).includes('owner')
              ? '<button class="btn-book-sm" onclick="event.stopPropagation();window.location.href=\'active-booking.html?minder=' + m.id + '\'">Book Now</button>'
              : '')) +
        '</div>' +
      '</div>';
    list.appendChild(card);
  });
}

// ===== PET MANAGEMENT =====
function openPetModal(petId) {
  const modal = document.getElementById('pet-modal');
  const title = document.getElementById('pet-modal-title');
  const del = document.getElementById('pet-delete-row');
  const saveBtn = document.getElementById('pet-save-btn');
  currentEditPetId = petId;
  document.getElementById('pet-edit-id').value = petId;
  if (petId === 'new') {
    title.textContent = 'Add New Pet'; del.style.display = 'none'; saveBtn.textContent = 'Add Pet';
    ['pet-name-input','pet-breed-input','pet-age-input','pet-medical-input','pet-care-input'].forEach(id => document.getElementById(id).value = '');
    document.getElementById('pet-type-input').value = 'Dog';
  } else {
    const pet = petData[petId]; if (!pet) { showToast('Pet not found'); return; }
    title.textContent = 'Edit ' + pet.name; del.style.display = 'block'; saveBtn.textContent = 'Save Changes';
    document.getElementById('pet-name-input').value = pet.name;
    document.getElementById('pet-type-input').value = pet.type;
    document.getElementById('pet-breed-input').value = pet.breed;
    document.getElementById('pet-age-input').value = pet.age;
    document.getElementById('pet-medical-input').value = pet.medical;
    document.getElementById('pet-care-input').value = pet.care;
  }
  modal.classList.add('open');
}
function closePetModal() { document.getElementById('pet-modal').classList.remove('open'); currentEditPetId = null; }

async function savePet() {
  const petId   = document.getElementById('pet-edit-id').value;
  const name    = document.getElementById('pet-name-input').value.trim();
  const type    = document.getElementById('pet-type-input').value;
  const breed   = document.getElementById('pet-breed-input').value.trim();
  const age     = document.getElementById('pet-age-input').value.trim();
  const medical = document.getElementById('pet-medical-input').value.trim();
  const care    = document.getElementById('pet-care-input').value.trim();
  if (!name) { showToast('❌ Please enter a pet name'); return; }
  if (!age) { showToast('❌ Please enter your pet\'s age'); return; }
  const ageNum = Number(age);
  if (isNaN(ageNum) || ageNum < 0 || ageNum > 100) { showToast('❌ Age must be between 0 and 100'); return; }
  const body = { name, type, breed, age, medical, care, emoji: petEmojis[type] || '🐾' };

  // On the auth page the registration form exists — pets must be staged locally
  // because the user has no account yet (token may be stale from a prior session).
  const isRegistering = !!document.getElementById('form-register');

  if (petId === 'new') {
    if (isRegistering) {
      const localId = 'reg_' + (regPetNextId++);
      body.id = localId;
      regPendingPets.push(body);
      closePetModal();
      showToast('✅ ' + name + ' added successfully!');
      refreshRegPets();
    } else {
      try {
        const pet = await api.createPet(body);
        petData[pet.id] = pet;
        store.setPets(petData);
        closePetModal();
        showToast('✅ ' + name + ' added successfully!');
        refreshPetsUI();
        refreshRegPets();
      } catch (err) {
        showToast('❌ ' + (err.message || 'Failed to save pet'));
      }
    }
  } else {
    // Editing a pending registration pet
    if (isRegistering) {
      const idx = regPendingPets.findIndex(p => p.id === petId);
      if (idx !== -1) { Object.assign(regPendingPets[idx], body); }
      closePetModal();
      showToast('✅ ' + name + ' updated!');
      refreshRegPets();
    } else {
      showConfirmModal('💾', 'Save Changes?', 'Save changes to ' + name + '?', async function() {
        try {
          const pet = await api.updatePet(petId, body);
          petData[pet.id] = pet;
          store.setPets(petData);
          closePetModal();
          showToast('✅ ' + name + ' updated!');
          refreshPetsUI();
          refreshRegPets();
        } catch (err) {
          showToast('❌ ' + (err.message || 'Failed to update pet'));
        }
      });
    }
  }
}

function confirmRemovePet() {
  const petId = document.getElementById('pet-edit-id').value;
  // Check pending registration pets first, then saved pets
  const regIdx = regPendingPets.findIndex(p => p.id === petId);
  const pet = regIdx !== -1 ? regPendingPets[regIdx] : petData[petId];
  if (!pet) return;
  showConfirmModal('🗑', 'Remove ' + pet.name + '?', 'Are you sure? This cannot be undone.', async function() {
    const petName = pet.name;
    if (regIdx !== -1) {
      regPendingPets.splice(regIdx, 1);
      closePetModal();
      showToast('🗑 ' + petName + ' removed');
      refreshRegPets();
    } else {
      try {
        await api.deletePet(petId);
        delete petData[petId];
        store.setPets(petData);
        closePetModal();
        showToast('🗑 ' + petName + ' removed');
        refreshPetsUI();
        refreshRegPets();
      } catch (err) {
        showToast('❌ ' + (err.message || 'Failed to remove pet'));
      }
    }
  });
}

function refreshPetsUI() {
  // Home pets grid
  const homeGrid = document.getElementById('home-pets-grid');
  if (homeGrid) {
    homeGrid.innerHTML = '';
    Object.keys(petData).forEach(id => {
      const p = petData[id];
      const card = document.createElement('div'); card.className = 'pet-card';
      card.onclick = () => openPetModal(id);
      card.innerHTML = '<div class="pet-emoji">' + (p.emoji||'🐾') + '</div><div class="pet-name">' + p.name + '</div><div class="pet-breed">' + p.breed + ' · ' + p.age + '</div>';
      homeGrid.appendChild(card);
    });
    const addCard = document.createElement('div'); addCard.className = 'pet-add-card'; addCard.onclick = () => openPetModal('new');
    addCard.innerHTML = '<div class="add-icon">＋</div>Add a Pet'; homeGrid.appendChild(addCard);
  }
  // Profile pets list
  const profileList = document.getElementById('profile-pets-list');
  if (profileList) {
    profileList.innerHTML = '';
    Object.keys(petData).forEach(id => {
      const p = petData[id];
      const item = document.createElement('div'); item.className = 'menu-item'; item.onclick = () => openPetModal(id);
      item.innerHTML = '<span class="menu-icon">' + (p.emoji||'🐾') + '</span><span class="menu-label">' + p.name + '</span><span class="menu-arrow">›</span>';
      profileList.appendChild(item);
    });
  }
  // Pet count
  const countEl = document.getElementById('home-pet-count');
  if (countEl) countEl.textContent = Object.keys(petData).length;
  // Names — only update once we have a cached value, otherwise leave the
  // HTML placeholder in place so the page doesn't flash an empty string.
  if (userProfile.firstName) {
    const profileName = document.getElementById('profile-display-name');
    if (profileName) profileName.textContent = userProfile.firstName;
    const homeName = document.getElementById('home-user-name');
    if (homeName) homeName.textContent = userProfile.firstName;
  }
  // Update profile avatar on profile.html
  renderProfileAvatar();
  // Update home page avatar if present
  const homeAvatar = document.getElementById('home-user-avatar');
  if (homeAvatar) {
    if (userProfile.profileImage) {
      homeAvatar.innerHTML = '<img src="' + userProfile.profileImage + '" alt="avatar" class="avatar-img avatar-home">';
    } else {
      homeAvatar.textContent = '👤';
    }
  }
}

// Show pets on registration page
function refreshRegPets() {
  const grid = document.getElementById('reg-pets-grid');
  if (!grid) return;
  grid.innerHTML = '';
  // During registration show pending pets; after login show saved pets
  const isRegistering = !!document.getElementById('form-register');
  const pets = isRegistering ? regPendingPets : Object.values(petData);
  pets.forEach(p => {
    const card = document.createElement('div'); card.className = 'reg-pet-card';
    card.onclick = () => openPetModal(p.id);
    card.innerHTML = '<span>' + (p.emoji||'🐾') + '</span><span>' + p.name + '</span><span style="color:var(--bark-light);font-size:11px">' + p.breed + '</span>';
    grid.appendChild(card);
  });
}

// ===== BOOKING PET SELECTION =====
function togglePetSelect(el, petId) {
  el.classList.toggle('selected');
  const check = el.querySelector('.pet-check');
  if (el.classList.contains('selected')) { check.style.opacity = '1'; if (!selectedPets.includes(petId)) selectedPets.push(petId); }
  else { check.style.opacity = '0.3'; selectedPets = selectedPets.filter(p => p !== petId); }
  if (selectedPets.length === 0) { el.classList.add('selected'); check.style.opacity = '1'; selectedPets.push(petId); showToast('You must select at least one pet'); return; }
  updateBookingSummary();
  // Selected pets changed — recompute which slots are blocked because the
  // same-pet conflict set now looks different.
  refreshBookingTimeAvailability();
}
function updateBookingSummary() {
  const petsEl = document.getElementById('summary-pets');
  if (petsEl) {
    petsEl.textContent = selectedPets
      .map(id => petData[id] ? (petData[id].emoji || '🐾') + ' ' + petData[id].name : id)
      .join(' & ') || '—';
  }

  const serviceEl = document.querySelector('.service-option.selected .service-name');
  const serviceSummaryEl = document.getElementById('summary-service');
  const serviceName = serviceEl ? serviceEl.textContent : 'Dog Walking';
  if (serviceSummaryEl) serviceSummaryEl.textContent = serviceName;

  const dateEl = document.querySelector('.date-chip.selected');
  const timeEl = document.querySelector('.time-chip.selected');
  const dateTimeEl = document.getElementById('summary-datetime');
  if (dateTimeEl && dateEl && timeEl) {
    const dayName = dateEl.dataset.dayName || '';
    const day = dateEl.dataset.day || dateEl.querySelector('.day-num').textContent;
    const month = dateEl.dataset.month || 'Apr';
    dateTimeEl.textContent = (dayName ? dayName + ' ' : '') + day + ' ' + month + ', ' + timeEl.textContent;
  }

  const servicePriceEl = document.querySelector('.service-option.selected .service-price');
  const basePrice = servicePriceEl ? parseInt(servicePriceEl.textContent.replace('£', '')) : 15;
  const total = basePrice + (selectedPets.length > 1 ? 5 * (selectedPets.length - 1) : 0);

  const totalEl = document.getElementById('summary-total');
  if (totalEl) totalEl.textContent = '£' + total.toFixed(2);
  const payBtn = document.getElementById('confirm-pay-btn');
  if (payBtn) payBtn.textContent = 'Confirm & Pay £' + total;
  const multiPetInfo = document.getElementById('multi-pet-info');
  if (multiPetInfo) multiPetInfo.classList.toggle('visible', selectedPets.length > 1);
}
async function confirmBooking() {
  const m           = window._activeMinder || { name: 'your minder', avatar: '🧑‍🦱', id: 'sarah' };
  const serviceEl   = document.querySelector('.service-option.selected .service-name');
  const serviceName = serviceEl ? serviceEl.textContent : 'Dog Walk';
  const dateEl      = document.querySelector('.date-chip.selected');
  const timeEl      = document.querySelector('.time-chip.selected');
  const time        = timeEl ? timeEl.textContent.trim() : '08:00';

  // Build an ISO date string (YYYY-MM-DD) from the chip's data attributes
  const day   = dateEl ? (dateEl.dataset.day   || String(new Date().getDate()).padStart(2,'0')) : String(new Date().getDate()).padStart(2,'0');
  const month = dateEl ? (dateEl.dataset.month || 'Apr') : 'Apr';
  const monthNums = { Jan:1,Feb:2,Mar:3,Apr:4,May:5,Jun:6,Jul:7,Aug:8,Sep:9,Oct:10,Nov:11,Dec:12 };
  const bookingDate = new Date().getFullYear() + '-' +
                      String(monthNums[month] || 4).padStart(2,'0') + '-' + day;

  // Prevent booking yourself
  if (String(m.id) === String(store.currentUserId())) {
    showToast('❌ You cannot book yourself as a minder');
    return;
  }

  if (selectedPets.length === 0) { showToast('❌ Please add a pet before booking'); return; }
  const selectedPetNames = selectedPets.map(id => (petData[id] && petData[id].name) || id);
  const selectedPetIds = selectedPets.slice();
  const petNames = selectedPetNames.join(' & ');
  const totalEl = document.getElementById('summary-total');
  const price   = totalEl ? totalEl.textContent : '£15.00';

  try {
    // Client-side same-pet pre-check for a nicer error message. The real
    // authoritative conflict enforcement (same-pet AND same-minder-accepted)
    // happens in POST /api/bookings on the server.
    const existingBookings = await api.getBookings();
    const conflict = existingBookings.find(b => {
      if (b.bookingDate !== bookingDate || b.bookingTime !== time) return false;
      if (b.status === 'cancelled' || b.status === 'declined') return false;
      const existingIds = Array.isArray(b.petIds) ? b.petIds.map(String) : [];
      if (existingIds.length && selectedPetIds.length) {
        return existingIds.some(id => selectedPetIds.map(String).includes(id));
      }
      const existingNames = String(b.petNames || '').split(/\s*&\s*/).map(n => n.trim().toLowerCase());
      return selectedPetNames.some(name => existingNames.includes(name.trim().toLowerCase()));
    });

    if (conflict) {
      showToast('❌ One of your selected pets already has a booking at that date/time');
      return;
    }

    await api.createBooking({
      minderKey:    m.id,
      minderName:   m.name,
      minderAvatar: m.avatar,
      minderImage:  m.profileImage || '',
      service:      serviceName,
      bookingDate,
      bookingTime:  time,
      petNames,
      petIds:       selectedPetIds,
      price
    });
    showToast('✅ Booking sent to ' + m.name + '!');
    setTimeout(() => window.location.href = 'bookings.html', 1200);
  } catch (err) {
    showToast('❌ ' + (err.message || 'Booking failed — are you logged in?'));
  }
}

// ===== REVIEWS (on minder profile) =====
function setReviewStars(n) {
  reviewStars = n;
  document.querySelectorAll('#review-stars .star-btn').forEach((s, i) => s.classList.toggle('active', i < n));
}
async function submitReview() {
  const text = document.getElementById('review-text-input').value.trim();
  if (!text) { showToast('❌ Please write a review'); return; }
  if (reviewStars === 0) { showToast('❌ Please select a star rating'); return; }
  if (!currentReviewMinder) { showToast('❌ No minder selected'); return; }

  try {
    await api.submitReview({ minderId: Number(currentReviewMinder), stars: reviewStars, text });
    showToast('✅ Review submitted!');
    document.getElementById('review-text-input').value = '';
    setReviewStars(0);
    // Refresh the reviews tab
    _cachedMinderReviews = null;
    const { reviews, average, count } = await api.getMinderReviews(currentReviewMinder);
    _cachedMinderReviews = { reviews, average, count };
    renderMinderReviews(reviews);
    // Update stars in header
    const starsEl = document.getElementById('mp-stars');
    if (starsEl && average) {
      const filled = Math.round(Number(average));
      const starStr2 = '★'.repeat(filled) + '☆'.repeat(5 - filled);
      starsEl.innerHTML = '<span style="color:#f5a623">' + starStr2 + '</span> <span style="font-size:13px;opacity:0.9">' + average + '</span> <span style="font-size:13px;opacity:0.7">(' + count + ' review' + (count !== 1 ? 's' : '') + ')</span>';
    }
  } catch (err) {
    showToast('❌ ' + (err.message || 'Could not submit review'));
  }
}

// ===== REVIEWS (from profile section) =====
function toggleReviewAccordion(section) {
  const body    = document.getElementById('accordion-' + section + '-body');
  const chevron = document.getElementById('accordion-' + section + '-chevron');
  if (!body) return;
  const isOpen = body.style.display !== 'none';
  body.style.display    = isOpen ? 'none' : 'block';
  chevron.style.transform = isOpen ? '' : 'rotate(90deg)';
}

async function openProfileReviews() {
  previousScreen = currentScreen;
  const roles    = Array.isArray(userProfile.role) ? userProfile.role : [userProfile.role];
  const isMinder = roles.includes('minder');
  const isOwner  = roles.includes('owner');
  const isBoth   = isMinder && isOwner;

  // Show/hide accordion sections based on role
  const accReceived = document.getElementById('accordion-received');
  const accGiven    = document.getElementById('accordion-given');
  if (accReceived) accReceived.style.display = isMinder ? 'block' : 'none';
  if (accGiven)    accGiven.style.display    = isOwner  ? 'block' : 'none';

  // Update subtitle
  const subtitle = document.getElementById('reviews-subtitle');
  if (subtitle) {
    if (isBoth)        subtitle.textContent = "Reviews you've received and given";
    else if (isMinder) subtitle.textContent = 'Reviews from pet owners';
    else               subtitle.textContent = "Leave reviews for minders you've booked";
  }

  // Show screen immediately so elements are visible while data loads
  show('profile-reviews'); currentScreen = 'profile-reviews';

  // Auto-open sections based on role
  if (isOwner) toggleReviewAccordion('given');
  if (isMinder) toggleReviewAccordion('received');

  // ── Section A: Reviews received (minder) ──
  if (isMinder) {
    const titleEl = document.getElementById('received-reviews-title');
    const rList   = document.getElementById('received-reviews-list');
    if (titleEl) titleEl.textContent = 'Loading…';
    try {
      const { reviews, average, count } = await api.getMinderReviews(userProfile.id);
      const subEl = document.getElementById('received-reviews-subtitle');
      if (subEl) {
        subEl.textContent = average
          ? '★ ' + average + ' avg · ' + count + ' review' + (count !== 1 ? 's' : '')
          : 'No reviews yet';
      }
      if (titleEl) titleEl.style.display = 'none'; // subtitle now carries avg
      if (rList) {
        rList.innerHTML = reviews.length
          ? reviews.map(r => {
              const stars = '★'.repeat(r.stars) + '☆'.repeat(5 - r.stars);
              const date  = new Date(r.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
              return '<div style="padding:14px 0;border-bottom:1px solid var(--sand-light)">' +
                '<div style="display:flex;justify-content:space-between;margin-bottom:4px">' +
                '<strong style="font-size:14px;color:var(--bark)">' + (r.reviewerName || 'Anonymous') + '</strong>' +
                '<span style="color:#f5a623">' + stars + '</span>' +
                '</div>' +
                '<p style="font-size:13px;color:var(--bark-light);line-height:1.6;margin:0">"' + r.text + '"</p>' +
                '<p style="font-size:11px;color:var(--bark-light);margin-top:6px">' + date + '</p>' +
                '</div>';
            }).join('')
          : '<p style="font-size:13px;color:var(--bark-light);text-align:center;padding:16px 0">No reviews received yet.</p>';
      }
    } catch {
      if (titleEl) { titleEl.style.display = ''; titleEl.textContent = 'Could not load reviews.'; }
    }
  }

  // ── Section B: Reviews given (owner) ──
  if (isOwner) {
    const list = document.getElementById('profile-reviews-minder-list');
    if (list) {
      list.innerHTML = '<p style="font-size:13px;color:var(--bark-light);text-align:center;padding:16px 0">Loading…</p>';
      try {
        const [bookings, myReviews] = await Promise.all([api.getBookings(), api.getMyReviews()]);
        const completed = bookings.filter(b => b.status === 'completed' && b.minder);
        // Deduplicate minders from completed bookings
        const seen = new Set();
        const realMinders = [];
        completed.forEach(b => {
          if (!seen.has(b.minder)) {
            seen.add(b.minder);
            realMinders.push({
              id:          b.minder,
              name:        b.minderName || 'Minder',
              avatar:      b.minderImage
                ? '<img src="' + b.minderImage + '" style="width:38px;height:38px;border-radius:50%;object-fit:cover">'
                : '<span style="font-size:22px">' + (b.avatar || '🧑‍🦱') + '</span>',
              lastBooking: b.day + ' ' + b.month + ' – ' + (b.petDetail || '')
            });
          }
        });

        list.innerHTML = '';

        // Show existing reviews first
        if (myReviews.length > 0) {
          const heading = document.createElement('p');
          heading.style.cssText = 'font-size:12px;font-weight:600;color:var(--bark-light);text-transform:uppercase;letter-spacing:0.5px;margin:0 0 10px';
          heading.textContent = 'Your Reviews';
          list.appendChild(heading);
          myReviews.forEach(r => {
            const stars = '★'.repeat(r.stars) + '☆'.repeat(5 - r.stars);
            const date  = new Date(r.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
            const card  = document.createElement('div');
            card.id = 'given-review-' + r.id;
            card.style.cssText = 'background:white;border-radius:var(--radius-sm);padding:14px;box-shadow:0 2px 8px var(--shadow);margin-bottom:10px';
            card.innerHTML =
              '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">' +
                '<div><span style="font-weight:600;font-size:13px;color:var(--bark)">' + escapeHTML(r.minderName) + '</span>' +
                '<span style="color:#f5a623;margin-left:8px;font-size:13px">' + stars + '</span></div>' +
                '<button onclick="deleteGivenReview(' + r.id + ')" style="background:none;border:none;color:#e53935;font-size:16px;cursor:pointer;padding:0" title="Delete">🗑</button>' +
              '</div>' +
              '<p style="font-size:13px;color:var(--bark-light);line-height:1.5;margin:0 0 4px">"' + escapeHTML(r.text) + '"</p>' +
              '<p style="font-size:11px;color:var(--bark-light);margin:0">' + date + '</p>';
            list.appendChild(card);
          });
        }

        // Then show minders available to review
        if (realMinders.length > 0) {
          const heading2 = document.createElement('p');
          heading2.style.cssText = 'font-size:12px;font-weight:600;color:var(--bark-light);text-transform:uppercase;letter-spacing:0.5px;margin:14px 0 10px';
          heading2.textContent = 'Write a Review';
          list.appendChild(heading2);
          realMinders.forEach(m => {
            const card = document.createElement('div');
            card.className = 'review-minder-card';
            card.onclick = () => openWriteReview(m.id, m.name);
            card.innerHTML = '<div class="review-minder-avatar">' + m.avatar + '</div><div class="review-minder-info"><div class="review-minder-name">' + m.name + '</div><div class="review-minder-booking">' + m.lastBooking + '</div></div><span style="color:var(--terra);font-weight:600;font-size:13px">Write Review ›</span>';
            list.appendChild(card);
          });
        }

        if (myReviews.length === 0 && realMinders.length === 0) {
          list.innerHTML = '<p style="font-size:13px;color:var(--bark-light);text-align:center;padding:16px 0">No completed bookings yet.</p>';
        }
      } catch {
        list.innerHTML = '<p style="font-size:13px;color:var(--bark-light);text-align:center;padding:16px 0">Could not load reviews.</p>';
      }
    }
  }
}

async function deleteGivenReview(reviewId) {
  showConfirmModal('🗑', 'Delete Review?', 'This will permanently remove your review.', async function() {
    try {
      await api.deleteReview(reviewId);
      const card = document.getElementById('given-review-' + reviewId);
      if (card) card.remove();
      showToast('✅ Review deleted');
    } catch (err) {
      showToast('❌ ' + (err.message || 'Could not delete review'));
    }
  });
}

function openWriteReview(minderId, minderName) {
  previousScreen = 'profile-reviews';
  currentReviewMinder = minderId;
  document.getElementById('write-review-title').textContent = 'Review ' + (minderName || 'Minder');
  document.getElementById('profile-review-text').value = '';
  profileReviewStars = 0;
  document.querySelectorAll('#profile-review-stars .star-btn').forEach(s => s.classList.remove('active'));
  show('write-review'); currentScreen = 'write-review';
}

function setProfileReviewStars(n) {
  profileReviewStars = n;
  document.querySelectorAll('#profile-review-stars .star-btn').forEach((s, i) => s.classList.toggle('active', i < n));
}

async function submitProfileReview() {
  const text = document.getElementById('profile-review-text').value.trim();
  if (!text) { showToast('❌ Please write a review'); return; }
  if (profileReviewStars === 0) { showToast('❌ Please select a star rating'); return; }
  if (!currentReviewMinder) { showToast('❌ No minder selected'); return; }

  try {
    await api.submitReview({ minderId: Number(currentReviewMinder), stars: profileReviewStars, text });
    showToast('✅ Review submitted!');
    document.getElementById('profile-review-text').value = '';
    setProfileReviewStars(0);
    goBack();
  } catch (err) {
    showToast('❌ ' + (err.message || 'Could not submit review'));
  }
}

// ===== PAYOUT (pages/payout-details.html) =====
async function loadPayoutDetails() {
  const card = document.getElementById('payout-saved-card');
  const body = document.getElementById('payout-saved-body');
  const title = document.getElementById('payout-form-title');
  const err   = document.getElementById('payout-error');
  if (err)  { err.style.display = 'none'; err.textContent = ''; }
  if (card) card.style.display = 'none';
  try {
    const p = await api.getPayout();
    if (p && p.hasPayout) {
      if (card) card.style.display = 'block';
      if (body) body.innerHTML =
        '<div><strong>Holder:</strong> ' + escapeHTML(p.accountHolderName || '—') + '</div>' +
        '<div><strong>Bank:</strong> '   + escapeHTML(p.bankName || '—') + '</div>' +
        '<div><strong>Sort code:</strong> ' + escapeHTML(p.sortCodeMasked || '—') + '</div>' +
        '<div><strong>Account:</strong> ' + escapeHTML(p.accountNumberMasked || '—') + '</div>' +
        (p.updatedAt ? '<div style="margin-top:6px;font-size:11px;opacity:0.7">Last updated ' + new Date(p.updatedAt).toLocaleDateString() + '</div>' : '');
      if (title) title.textContent = 'Update payout details';
    } else {
      if (title) title.textContent = 'Add payout details';
    }
  } catch { /* treat as unset */ }
  ['payout-name-input','payout-bank-input','payout-sort-input','payout-account-input'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
}

async function savePayoutDetails() {
  const name    = (document.getElementById('payout-name-input')?.value || '').trim();
  const bank    = (document.getElementById('payout-bank-input')?.value || '').trim();
  const sort    = (document.getElementById('payout-sort-input')?.value || '').replace(/\D/g, '');
  const account = (document.getElementById('payout-account-input')?.value || '').replace(/\D/g, '');
  const errEl   = document.getElementById('payout-error');
  const setErr  = msg => { if (errEl) { errEl.textContent = msg; errEl.style.display = 'block'; } };
  if (name.length < 2) return setErr('Please enter the account holder name.');
  if (bank.length < 2) return setErr('Please enter the bank name.');
  if (sort.length !== 6)    return setErr('Sort code must be 6 digits.');
  if (account.length !== 8) return setErr('Account number must be 8 digits.');
  try {
    await api.updatePayout({ accountHolderName: name, bankName: bank, sortCode: sort, accountNumber: account });
    showToast('✅ Payout details saved');
    if (typeof loadPayoutDetails === 'function') loadPayoutDetails();
  } catch (err) { setErr(err.message || 'Failed to save'); }
}

// ===== PAYMENT MODAL =====
let _pendingBookingPayload = null;

async function openPaymentModal() {
  const m = window._activeMinder || { name: 'your minder', avatar: '🧑‍🦱' };
  const serviceEl = document.querySelector('.service-option.selected .service-name');
  const serviceName = serviceEl ? serviceEl.textContent : 'Dog Walk';
  const dateEl = document.querySelector('.date-chip.selected');
  const timeEl = document.querySelector('.time-chip.selected');
  const time = timeEl ? timeEl.textContent.trim() : '08:00';
  const day = dateEl ? (dateEl.dataset.day || String(new Date().getDate()).padStart(2,'0')) : String(new Date().getDate()).padStart(2,'0');
  const month = dateEl ? (dateEl.dataset.month || 'Apr') : 'Apr';
  const monthNums = { Jan:1,Feb:2,Mar:3,Apr:4,May:5,Jun:6,Jul:7,Aug:8,Sep:9,Oct:10,Nov:11,Dec:12 };
  const bookingDate = new Date().getFullYear() + '-' + String(monthNums[month] || 4).padStart(2,'0') + '-' + day;

  if (String(m.id) === String(store.currentUserId())) { showToast('❌ You cannot book yourself'); return; }
  if (selectedPets.length === 0) { showToast('❌ Please add a pet before booking'); return; }

  const availCheck = checkMinderAvailability(m, bookingDate, time);
  if (!availCheck.ok) { showToast('❌ ' + availCheck.reason); return; }

  const selectedPetNames = selectedPets.map(id => (petData[id] && petData[id].name) || id);
  const selectedPetIds = selectedPets.slice();
  const totalEl = document.getElementById('summary-total');
  const price = totalEl ? totalEl.textContent : '£15.00';

  try {
    const existingBookings = await api.getBookings();
    const conflict = existingBookings.find(b => {
      if (b.bookingDate !== bookingDate || b.bookingTime !== time) return false;
      if (b.status === 'cancelled' || b.status === 'declined') return false;
      const ids = Array.isArray(b.petIds) ? b.petIds.map(String) : [];
      return ids.length ? ids.some(id => selectedPetIds.map(String).includes(id))
        : String(b.petNames||'').split(/\s*&\s*/).map(n=>n.toLowerCase()).some(n=>selectedPetNames.map(x=>x.toLowerCase()).includes(n));
    });
    if (conflict) { showToast('❌ One of your selected pets already has a booking at that time'); return; }
  } catch { /* silent — backend will re-check */ }

  _pendingBookingPayload = {
    minderKey: m.id, minderName: m.name, minderAvatar: m.avatar, minderImage: m.profileImage || '',
    service: serviceName, bookingDate, bookingTime: time,
    petNames: selectedPetNames.join(' & '), petIds: selectedPetIds, price
  };

  const amtEl = document.getElementById('pay-modal-amount');
  if (amtEl) amtEl.textContent = price;
  const errEl = document.getElementById('pay-error');
  if (errEl) { errEl.style.display = 'none'; errEl.textContent = ''; }
  const modal = document.getElementById('pay-modal');
  if (modal) modal.style.display = 'flex';
}

function formatCardNumber(el) {
  el.value = el.value.replace(/\D/g, '').slice(0, 16).replace(/(.{4})/g, '$1 ').trim();
}
function formatExpiry(el) {
  let d = el.value.replace(/\D/g, '').slice(0, 4);
  if (d.length >= 3) d = d.slice(0, 2) + '/' + d.slice(2);
  el.value = d;
}
function luhnValid(num) {
  const d = String(num).replace(/\D/g, '');
  if (d.length < 13 || d.length > 19) return false;
  let sum = 0, alt = false;
  for (let i = d.length - 1; i >= 0; i--) {
    let n = +d[i]; if (alt) { n *= 2; if (n > 9) n -= 9; } sum += n; alt = !alt;
  }
  return sum % 10 === 0;
}
function closePaymentModal() {
  const modal = document.getElementById('pay-modal');
  if (modal) modal.style.display = 'none';
}
async function submitPayment() {
  if (!_pendingBookingPayload) { showToast('❌ Booking data missing'); return; }
  const name     = document.getElementById('pay-name')?.value.trim();
  const number   = document.getElementById('pay-number')?.value.replace(/\s/g, '');
  const expiry   = document.getElementById('pay-expiry')?.value.trim();
  const cvv      = document.getElementById('pay-cvv')?.value.trim();
  const postcode = document.getElementById('pay-postcode')?.value.trim().toUpperCase();
  const errEl    = document.getElementById('pay-error');
  const setErr   = msg => { if (errEl) { errEl.textContent = msg; errEl.style.display = 'block'; } };
  if (!name || name.length < 2) return setErr('Please enter the cardholder name.');
  if (!/^\d{13,19}$/.test(number)) return setErr('Card number must be 13–19 digits.');
  if (!/^\d{2}\/\d{2}$/.test(expiry)) return setErr('Expiry must be MM/YY.');
  const [mm] = expiry.split('/').map(Number);
  if (mm < 1 || mm > 12) return setErr('Invalid expiry month.');
  if (!/^\d{3,4}$/.test(cvv)) return setErr('CVV must be 3 or 4 digits.');
  if (!/^[A-Z0-9 ]{3,8}$/.test(postcode)) return setErr('Invalid postcode.');
  const btn = document.getElementById('pay-submit-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Authorising…'; }
  const payment = {
    method: 'card', cardholderName: name, last4: number.slice(-4), expiry, postcode,
    status: 'authorised', transactionId: 'txn_' + Date.now().toString(36),
    amount: _pendingBookingPayload.price, authorisedAt: new Date().toISOString()
  };
  try {
    await api.createBooking(Object.assign({}, _pendingBookingPayload, { payment }));
    closePaymentModal();
    showToast('✅ Payment authorised — booking sent to ' + (window._activeMinder?.name || 'minder'));
    setTimeout(() => window.location.href = 'bookings.html', 1200);
  } catch (err) {
    if (btn) { btn.disabled = false; btn.textContent = 'Authorise Payment'; }
    setErr(err.message || 'Booking failed');
  }
}

// ===== ROUTE TRACKING & HISTORY =====
let _liveTickListener = null, _liveBookingId = null, _liveStartCoord = null;
let _liveWatchdog = null, _routeViewMap = null;

function pathMeters(path) {
  if (!path || path.length < 2) return 0;
  let d = 0;
  for (let i = 1; i < path.length; i++) {
    const dLat = (path[i].lat - path[i-1].lat) * 111320;
    const dLng = (path[i].lng - path[i-1].lng) * 111320 * Math.cos(path[i-1].lat * Math.PI / 180);
    d += Math.hypot(dLat, dLng);
  }
  return d;
}
function metersToKmStr(m) { return m < 1000 ? Math.round(m) + ' m' : (m / 1000).toFixed(1) + ' km'; }
function msToMinutesStr(ms) { const m = Math.round(ms / 60000); return m < 60 ? m + ' min' : Math.floor(m/60) + 'h ' + (m%60) + 'min'; }
function metersBetween(a, b) {
  const dLat = (b.lat - a.lat) * 111320;
  const dLng = (b.lng - a.lng) * 111320 * Math.cos(a.lat * Math.PI / 180);
  return Math.hypot(dLat, dLng);
}
function resolveUserStartCoord() {
  if (userProfile && Number.isFinite(userProfile.locationLat) && Number.isFinite(userProfile.locationLng)) {
    return { lat: userProfile.locationLat, lng: userProfile.locationLng };
  }
  return (typeof PawTracking !== 'undefined') ? PawTracking.geocodeCity(userProfile?.location) : { lat: 51.5074, lng: -0.1278 };
}

function initLiveTracking(bookings) {
  if (typeof PawTracking === 'undefined') return;
  const card = document.getElementById('bookings-gps-live');
  if (!card) return;
  const live = PawTracking.getLiveBooking(bookings || []);
  if (!live) { card.dataset.hasLive = ''; card.style.display = 'none'; scheduleLiveWatchdog(bookings); return; }
  const startCoord = resolveUserStartCoord();
  _liveStartCoord = startCoord; _liveBookingId = live.id;
  card.dataset.hasLive = '1';
  card.style.display = document.getElementById('bookings-upcoming')?.style.display !== 'none' ? 'block' : 'none';
  const titleEl = document.getElementById('gps-live-title');
  if (titleEl) titleEl.textContent = '📍 Live · ' + (live.service || 'Walk') + ' · ' + (live.minderName || 'Minder');
  const w = PawTracking.windowFor(live);
  PawTracking.startTracking({ bookingId: live.id, startCoord, startsAt: w?.start, endsAt: w?.end, service: live.service });
  if (_liveTickListener) PawTracking.offTick(_liveTickListener);
  _liveTickListener = (bid, path, state) => {
    if (bid !== _liveBookingId) return;
    const distEl = document.getElementById('gps-live-distance');
    const durEl  = document.getElementById('gps-live-duration');
    const statEl = document.getElementById('gps-live-status');
    if (distEl) distEl.textContent = metersToKmStr(pathMeters(path));
    if (durEl)  durEl.textContent  = msToMinutesStr(Date.now() - state.startedAt);
    if (statEl) statEl.textContent = Date.now() >= state.endsAt ? 'Completed' : 'Active';
    if (Date.now() >= state.endsAt) { renderPastRoutes(); initLiveTracking(allBookingsCache); }
  };
  PawTracking.onTick(_liveTickListener);
}

function scheduleLiveWatchdog(bookings) {
  if (_liveWatchdog) return;
  _liveWatchdog = setInterval(() => {
    if (_liveBookingId && PawTracking.isTracking(_liveBookingId)) return;
    initLiveTracking(allBookingsCache || bookings || []);
  }, 30000);
}

async function renderPastRoutes() {
  const host = document.getElementById('bookings-past-routes-list');
  if (!host) return;
  let routes = [];
  try { routes = await api._req('GET', '/routes'); } catch { routes = []; }
  if (!routes?.length) { host.innerHTML = '<p style="font-size:13px;color:var(--bark-light);margin:8px 0">No recorded walks yet.</p>'; return; }
  const byBooking = {};
  (allBookingsCache || []).forEach(b => { byBooking[b.id] = b; });
  routes.sort((a, b) => new Date(b.endedAt) - new Date(a.endedAt));
  host.innerHTML = routes.map(r => {
    const b = byBooking[r.bookingId] || {};
    const distM = pathMeters(r.path || []);
    const firstT = r.path?.[0]?.t, lastT = r.path?.[r.path.length-1]?.t;
    const durMs = (firstT && lastT) ? lastT - firstT : 0;
    const title = (b.petNames || 'Walk') + (b.minderName ? ' with ' + b.minderName : '');
    const date  = b.bookingDate || (r.endedAt || '').slice(0, 10);
    return '<div class="gps-route-card" onclick="openRouteViewModal(' + r.bookingId + ')"><div class="gps-route-icon">🗺️</div><div class="gps-route-info"><div class="gps-route-date">' + escapeHTML(date + ' – ' + title) + '</div><div class="gps-route-detail">' + metersToKmStr(distM) + ' · ' + msToMinutesStr(durMs) + '</div></div><span style="color:var(--bark-light);font-size:16px">›</span></div>';
  }).join('');
}

async function openRouteViewModal(bookingId) {
  const modal = document.getElementById('route-view-modal');
  if (!modal) return;
  modal.classList.add('open');
  let route = null;
  try { route = await api.getRoute(bookingId); } catch { showToast('❌ Could not load route'); return; }
  if (!route?.path?.length) { showToast('Route is empty'); return; }
  const b = (allBookingsCache || []).find(x => x.id === Number(bookingId)) || {};
  const title = document.getElementById('route-view-title');
  if (title) title.textContent = (b.bookingDate || '') + ' – ' + (b.petNames || 'Walk') + (b.minderName ? ' with ' + b.minderName : '');
  const distEl = document.getElementById('route-view-distance');
  const durEl  = document.getElementById('route-view-duration');
  if (distEl) distEl.textContent = metersToKmStr(pathMeters(route.path));
  const firstT = route.path[0].t, lastT = route.path[route.path.length-1].t;
  if (durEl) durEl.textContent = msToMinutesStr(lastT - firstT);
  if (typeof window.whenMapsReady !== 'function' || !window.hasGoogleMapsKey?.()) {
    showToast('⚠️ Set GOOGLE_MAPS_API_KEY in js/config.js to view routes');
    return;
  }
  window.whenMapsReady(() => {
    const el = document.getElementById('route-view-map');
    if (!el) return;
    _routeViewMap = new google.maps.Map(el, { disableDefaultUI: true, zoomControl: true, gestureHandling: 'greedy' });
    const latlngs = route.path.map(p => ({ lat: p.lat, lng: p.lng }));
    new google.maps.Polyline({ path: latlngs, strokeColor: '#d97350', strokeOpacity: 0.9, strokeWeight: 4, map: _routeViewMap });
    new google.maps.Marker({ position: latlngs[0], map: _routeViewMap, title: 'Start' });
    new google.maps.Marker({ position: latlngs[latlngs.length-1], map: _routeViewMap, title: 'End' });
    const bounds = new google.maps.LatLngBounds();
    latlngs.forEach(ll => bounds.extend(ll));
    _routeViewMap.fitBounds(bounds, 24);
  });
}

function closeRouteViewModal() {
  const modal = document.getElementById('route-view-modal');
  if (modal) modal.classList.remove('open');
  _routeViewMap = null;
  const el = document.getElementById('route-view-map');
  if (el) el.innerHTML = '';
}

// ===== HELP CENTRE / REPORT =====
function openHelpCentre() {
  previousScreen = currentScreen;
  document.getElementById('report-search-input').value = '';
  document.getElementById('report-reason').value = '';
  document.getElementById('report-search-results').innerHTML = '';
  document.getElementById('report-selected-user').style.display = 'none';
  reportSelectedUser = null;
  show('help'); currentScreen = 'help';
}

function searchReportUsers() {
  const query = document.getElementById('report-search-input').value.trim().toLowerCase();
  const results = document.getElementById('report-search-results');
  if (query.length < 1) { results.innerHTML = ''; return; }
  const matches = allUsers.filter(u => u.name.toLowerCase().includes(query));
  results.innerHTML = '';
  matches.forEach(u => {
    const item = document.createElement('div'); item.className = 'report-result-item';
    item.innerHTML = '<span style="font-weight:600">' + u.name + '</span><span style="font-size:12px;color:var(--bark-light)">' + u.role + '</span>';
    item.onclick = () => selectReportUser(u);
    results.appendChild(item);
  });
}

function selectReportUser(user) {
  reportSelectedUser = user;
  document.getElementById('report-selected-name').textContent = user.name + ' (' + user.role + ')';
  document.getElementById('report-selected-user').style.display = 'block';
  document.getElementById('report-search-input').value = '';
  document.getElementById('report-search-results').innerHTML = '';
}

function clearReportSelection() {
  reportSelectedUser = null;
  document.getElementById('report-selected-user').style.display = 'none';
}

function submitReport() {
  if (!reportSelectedUser) { showToast('❌ Please select a user to report'); return; }
  const reason = document.getElementById('report-reason').value.trim();
  if (!reason) { showToast('❌ Please provide a reason'); return; }
  showConfirmModal('🚨', 'Submit Report?', 'Report ' + reportSelectedUser.name + ' for violating community guidelines?', async function() {
    try {
      await api.createDispute({
        against: reportSelectedUser.name + ' (' + reportSelectedUser.role + ')',
        reason: reason
      });
      showToast('✅ Report submitted. Our team will review it.');
    } catch { showToast('⚠️ Report saved locally'); }
    clearReportSelection();
    document.getElementById('report-reason').value = '';
  });
}

// ===== EDIT PROFILE =====
// ===== CHIP SELECTORS & PRICE HELPERS =====
// Toggle chip active state on click
document.addEventListener('click', function(e) {
  if (e.target.classList.contains('chip-btn')) {
    e.target.classList.toggle('active');
  }
});
// Read selected chips as comma-separated string
function getSelectedChips(containerId) {
  const el = document.getElementById(containerId);
  if (!el) return '';
  return Array.from(el.querySelectorAll('.chip-btn.active')).map(b => b.getAttribute('data-value')).join(', ');
}
// Set selected chips from comma-separated string
function setSelectedChips(containerId, csv) {
  const el = document.getElementById(containerId);
  if (!el) return;
  const vals = csv.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  el.querySelectorAll('.chip-btn').forEach(b => {
    b.classList.toggle('active', vals.includes(b.getAttribute('data-value').toLowerCase()));
  });
}
// Clamp price input value to 0–50
function clampPrice(input) {
  if (!input) return 0;
  let v = parseInt(input.value, 10);
  if (isNaN(v) || v < 0) v = 0;
  if (v > 1000000) v = 1000000;
  return v;
}

// ===== CERTIFICATIONS TAG SYSTEM =====
let _certTags = [];

function escapeHTML(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

function renderCertTags(tags) {
  _certTags = tags ? [...tags] : [];
  const list = document.getElementById('cert-tags-list');
  if (!list) return;
  if (_certTags.length === 0) { list.innerHTML = ''; return; }
  list.innerHTML = _certTags.map((tag, i) =>
    '<span style="display:inline-flex;align-items:center;gap:6px;background:var(--sand-light);color:var(--bark);border-radius:20px;padding:5px 10px 5px 14px;font-size:13px;margin-bottom:2px">' +
      escapeHTML(tag) +
      '<button type="button" onclick="removeCertTag(' + i + ')" style="background:none;border:none;color:#e53935;cursor:pointer;font-size:16px;line-height:1;padding:0;display:flex;align-items:center" title="Remove">🗑</button>' +
    '</span>'
  ).join('');
}

function addCertTag() {
  const input = document.getElementById('cert-tag-input');
  if (!input) return;
  const val = input.value.trim();
  if (!val) { showToast('❌ Please type a certification first'); return; }
  if (_certTags.includes(val)) { showToast('❌ Already added'); return; }
  _certTags.push(val);
  input.value = '';
  renderCertTags(_certTags);
}

function removeCertTag(index) {
  _certTags.splice(index, 1);
  renderCertTags(_certTags);
}

function openEditProfileModal() {
  document.getElementById('edit-first-name').value = userProfile.firstName;
  document.getElementById('edit-last-name').value = userProfile.lastName;
  document.getElementById('edit-email').value = userProfile.email;
  document.getElementById('edit-phone').value = userProfile.phone;
  document.getElementById('edit-location').value = userProfile.location;
  document.getElementById('edit-bio').value = userProfile.bio;
  // Show minder fields for minder role OR owners who have become minders
  const isMinderProfile = (Array.isArray(userProfile.role) ? userProfile.role : [userProfile.role]).includes('minder');
  const minderFields = document.getElementById('minder-fields');
  if (minderFields) {
    minderFields.style.display = isMinderProfile ? 'block' : 'none';
    if (isMinderProfile) {
      document.getElementById('edit-service-area').value = userProfile.serviceArea || '';
      setSelectedChips('edit-pet-type-chips', userProfile.petsCaredFor || '');
      const _adminEnabled = Array.isArray(userProfile.enabledServices) ? userProfile.enabledServices : [];
      // Set chip selection from the minder's actual saved services (includes any
      // advanced ones they have previously chosen to offer).
      setSelectedChips('edit-service-type-chips', userProfile.services || '');
      // Show advanced chips only when admin has unlocked them; make them fully
      // interactive so the minder can opt in or out. They start unselected unless
      // already saved in services.
      document.querySelectorAll('#edit-service-type-chips .chip-btn').forEach(btn => {
        const val = btn.getAttribute('data-value');
        if (ADVANCED_SERVICES.includes(val)) {
          if (_adminEnabled.includes(val)) {
            btn.style.display = '';    // visible
            btn.disabled = false;      // fully clickable
            btn.title = 'Unlocked by admin';
          } else {
            btn.style.display = 'none';
            btn.classList.remove('active');
          }
        }
      });
      document.getElementById('edit-price-min').value = userProfile.priceMin != null ? userProfile.priceMin : 10;
      document.getElementById('edit-price-max').value = userProfile.priceMax != null ? userProfile.priceMax : 25;
      document.getElementById('edit-experience').value = userProfile.experience || '';
      // Load certifications tags
      renderCertTags(Array.isArray(userProfile.certificationTags) ? userProfile.certificationTags : (userProfile.certifications ? userProfile.certifications.split('\n').filter(Boolean) : []));
      // Load availability grid
      loadAvailabilityGrid(userProfile.availability || {});

    }
  }
  document.getElementById('edit-profile-modal').classList.add('open');
}
function closeEditProfileModal() { document.getElementById('edit-profile-modal').classList.remove('open'); }

function saveProfile() {
  const fn = document.getElementById('edit-first-name').value.trim();
  if (!fn) { showToast('❌ First name is required'); return; }
  showConfirmModal('💾', 'Save Profile Changes?', 'Update your profile information?', async function() {
    const updates = {
      firstName: fn,
      lastName:  document.getElementById('edit-last-name').value.trim(),
      email:     document.getElementById('edit-email').value.trim(),
      phone:     document.getElementById('edit-phone').value.trim(),
      location:  document.getElementById('edit-location').value.trim(),
      bio:       document.getElementById('edit-bio').value.trim(),
    };
      if ((Array.isArray(userProfile.role) ? userProfile.role : [userProfile.role]).includes('minder')) {
        updates.serviceArea  = (document.getElementById('edit-service-area') || {}).value || '';
        updates.petsCaredFor = getSelectedChips('edit-pet-type-chips');
        // Save all selected service chips. Advanced chips are only visible when admin has unlocked them.
        updates.services = getSelectedChips('edit-service-type-chips');
        updates.priceMin     = clampPrice(document.getElementById('edit-price-min'));
        updates.priceMax     = clampPrice(document.getElementById('edit-price-max'));
        updates.experience   = (document.getElementById('edit-experience') || {}).value || '';
        updates.certificationTags = [..._certTags];
        updates.availability = readAvailabilityGrid();
      }
    // Optimistic local update so the UI feels instant
    Object.assign(userProfile, updates);
    store.setUser(userProfile);
    closeEditProfileModal();
    refreshPetsUI();
    renderProfileAvatar();

    // Push to the backend so the change survives logout/login
    try {
      const saved = await api.updateMe(updates);
      hydrateUserProfile(saved);
      store.setUser(userProfile);
      refreshPetsUI();
      renderProfileAvatar();
      showToast('✅ Profile updated!');
    } catch (err) {
      showToast('⚠️ Saved locally — ' + (err.message || 'server update failed'));
    }
  });
}

// ===== CONFIRM MODAL =====
let confirmCallback = null;
function showConfirmModal(icon, title, message, onConfirm) {
  document.getElementById('confirm-modal-icon').textContent = icon;
  document.getElementById('confirm-modal-title').textContent = title;
  document.getElementById('confirm-modal-message').textContent = message;
  confirmCallback = onConfirm;
  const btn = document.getElementById('confirm-modal-btn');
  btn.onclick = function() { closeConfirmModal(); if (confirmCallback) { confirmCallback(); confirmCallback = null; } };
  document.getElementById('confirm-modal').classList.add('open');
}
function closeConfirmModal() { document.getElementById('confirm-modal').classList.remove('open'); }

// ===== LOGOUT =====
function confirmLogout() {
  showConfirmModal('🚪', 'Log Out?', 'Are you sure you want to log out?', function() { logout(); });
}
function logout() {
  isAdmin = false;
  api.clearSession();
  window.location.href = '../index.html';
}

// ===== ADMIN =====
// Fetches users + disputes from the backend and renders both panels.
async function loadAdminData() {
  try {
    const [users, disputes] = await Promise.all([
      api.getAdminUsers(),
      api.getDisputes()
    ]);
    adminUsers    = users;
    adminDisputes = disputes;
    renderAdminPanels();
    restoreAdminTab();
  } catch (err) {
    showToast('❌ ' + (err.message || 'Failed to load admin data'));
  }
}

// ── Admin: ADVANCED_SERVICES list (mirrors backend) ──
const ADVANCED_SERVICES = ['Grooming', 'Vet', 'Training'];

function openAdminUserDetail(userId) {
  // Dismiss any pending service_application notifications for this user
  const notifCache = notifMinderMessages || [];
  const toDelete = notifCache.filter(n => n.type === 'service_application' && n.applicantId === userId && !n.read);
  if (toDelete.length) {
    toDelete.forEach(n => api.deleteNotification(n.id).catch(() => {}));
    notifMinderMessages = notifMinderMessages.filter(n => !toDelete.some(d => d.id === n.id));
    loadNotificationCount();
  }
  const u = adminUsers.find(x => x.id === userId);
  if (!u) return;
  const isMinder = u.rawRoles ? u.rawRoles.includes('minder') : u.role.toLowerCase().includes('minder');
  const avatarHTML = u.profileImage
    ? '<img src="' + u.profileImage + '" alt="" style="width:64px;height:64px;border-radius:50%;object-fit:cover">'
    : '<span style="font-size:40px">👤</span>';
  const statusBadge = u.status !== 'Active'
    ? '<span style="color:#e53935;font-size:12px;font-weight:600"> (' + u.status + ')</span>' : '';

  let minderSection = '';
  if (isMinder) {
    const enabled    = Array.isArray(u.enabledServices) ? u.enabledServices : [];
    const BASIC_SERVICES   = ['Walking', 'Home Visit'];
    const basicList  = (u.services || '').split(',').map(s => s.trim()).filter(Boolean);
    // Always include the two basic services every minder can offer,
    // plus whatever is in their services string, plus admin-enabled services
    const allOffered = [...new Set([...BASIC_SERVICES, ...basicList, ...enabled])];
    const serviceChips = allOffered.length
      ? allOffered.map(s =>
          '<span style="padding:4px 12px;border-radius:12px;font-size:12px;font-weight:500;background:var(--sand-light);color:var(--bark)">' + s + '</span>'
        ).join(' ')
      : '<span style="color:var(--bark-light);font-size:13px">No services yet</span>';
    // Pending service applications from the minder
    const pending = Array.isArray(u.pendingServices) ? u.pendingServices : [];
    const pendingSection = pending.length
      ? '<div style="background:#fff8e1;border:1.5px solid #f5a623;border-radius:var(--radius-sm);margin-bottom:14px;overflow:hidden">' +
          '<button onclick="adminDismissPending(' + u.id + ')" style="width:100%;display:flex;align-items:center;justify-content:space-between;padding:12px 14px;background:transparent;border:none;cursor:pointer;text-align:left">' +
            '<div>' +
              '<div style="font-size:12px;font-weight:600;color:#e65100;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px">📋 Pending Service Applications</div>' +
              '<div style="display:flex;flex-wrap:wrap;gap:6px">' +
                pending.map(s => '<span style="background:#f5a623;color:white;padding:3px 10px;border-radius:12px;font-size:12px;font-weight:600">' + s + '</span>').join('') +
              '</div>' +
            '</div>' +
            '<span style="font-size:11px;color:#e65100;flex-shrink:0;margin-left:10px">✕ Dismiss</span>' +
          '</button>' +
        '</div>'
      : '';

    const toggles = ADVANCED_SERVICES.map(svc => {
      const isOn = enabled.includes(svc);
      return '<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--sand-light)">' +
        '<div><div style="font-weight:500;font-size:14px;color:var(--bark)">' + svc + '</div>' +
          '<div style="font-size:12px;color:var(--bark-light)">Admin-enabled service</div></div>' +
        '<label class="avail-toggle" onclick="event.stopPropagation()">' +
          '<input type="checkbox" ' + (isOn ? 'checked' : '') +
            ' onchange="adminToggleService(' + u.id + ', \'' + svc + '\', this.checked)">' +
              '<span class="avail-slider"></span>' +
          '</label></div>';
    }).join('');
    const quals = Array.isArray(u.qualificationImages) ? u.qualificationImages : [];
    const qualsSection = quals.length
      ? '<div style="margin-top:14px;border:1.5px solid var(--sand-light);border-radius:var(--radius-sm);overflow:hidden">' +
          '<button onclick="toggleAdminQuals(this)" style="width:100%;display:flex;align-items:center;justify-content:space-between;padding:12px 14px;background:var(--sand-light);border:none;cursor:pointer;font-family:\'DM Sans\',sans-serif;font-size:13px;font-weight:600;color:var(--bark)">' +
            '<span>📎 Uploaded Qualifications (' + quals.length + ')</span>' +
            '<span class="quals-chevron" style="transition:transform 0.2s;display:inline-block">▼</span>' +
          '</button>' +
          '<div class="quals-body" style="display:none;flex-wrap:wrap;gap:10px;padding:12px">' +
            quals.map(q =>
              '<div style="position:relative;width:calc(50% - 5px)">' +
                '<img src="' + q.image + '" alt="Qualification" style="width:100%;border-radius:8px;object-fit:contain;border:1px solid var(--sand-light);cursor:zoom-in;max-height:160px" onclick="openImagePreview(this.src)">' +
                '<button onclick="adminDeleteQual(' + u.id + ',\'' + q.id + '\')" style="position:absolute;top:4px;right:4px;background:rgba(0,0,0,0.6);color:white;border:none;border-radius:50%;width:22px;height:22px;font-size:13px;cursor:pointer;line-height:1;display:flex;align-items:center;justify-content:center" title="Delete">×</button>' +
              '</div>'
            ).join('') +
          '</div>' +
        '</div>'
      : '<div style="margin-top:14px;padding:10px 14px;background:var(--sand-light);border-radius:var(--radius-sm);font-size:13px;color:var(--bark-light)">📎 No qualifications to view.</div>';

    minderSection =
      '<div style="margin-top:18px">' +
        '<div style="font-size:12px;font-weight:600;color:var(--bark-light);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px">Current Services</div>' +
        '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:16px">' + serviceChips + '</div>' +
        pendingSection +
        '<div style="font-size:12px;font-weight:600;color:var(--bark-light);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px">Enable Advanced Services</div>' +
        '<div>' + toggles + '</div>' +
        '<div style="font-size:11px;color:var(--bark-light);margin-top:10px">Toggling sends the minder a notification and updates their profile immediately.</div>' +
        qualsSection +
      '</div>';
  }

  const infoRows = [
    ['Email', u.email],
    ['Role', u.role],
    ['Status', u.status || 'Active'],
    ...(isMinder ? [
      ['Service Area', u.serviceArea || '—'],
      ['Experience', u.experience || '—'],
      ['Rate', (u.priceMin != null && u.priceMax != null) ? '£' + u.priceMin + ' – £' + u.priceMax + '/hr' : '—'],
      ['Availability', u.availableForBooking !== false ? '✅ Available' : '🌴 Not taking bookings'],
    ] : [])
  ];
  const rows = infoRows.map(([label, val]) =>
    '<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--sand-light)">' +
    '<span style="color:var(--bark-light);font-size:13px">' + label + '</span>' +
    '<span style="font-weight:500;font-size:13px;color:var(--bark);text-align:right;max-width:60%">' + val + '</span></div>'
  ).join('');

  document.getElementById('admin-detail-body').innerHTML =
    '<div style="display:flex;align-items:center;gap:14px;margin-bottom:16px">' +
      '<div style="width:64px;height:64px;border-radius:50%;overflow:hidden;flex-shrink:0;display:flex;align-items:center;justify-content:center;background:var(--sand-light)">' + avatarHTML + '</div>' +
      '<div><div style="font-family:\'Playfair Display\',serif;font-size:18px;font-weight:600;color:var(--bark)">' + u.name + statusBadge + '</div>' +
      '<div style="font-size:13px;color:var(--bark-light);margin-top:2px">' + u.role + '</div></div>' +
    '</div>' +
    '<div>' + rows + '</div>' +
    minderSection +
    '<div style="margin-top:14px;border:1.5px solid var(--sand-light);border-radius:var(--radius-sm);overflow:hidden">' +
      '<button onclick="toggleAdminReviews(this,' + u.id + ')" style="width:100%;display:flex;align-items:center;justify-content:space-between;padding:12px 14px;background:var(--sand-light);border:none;cursor:pointer;font-family:\'DM Sans\',sans-serif;font-size:13px;font-weight:600;color:var(--bark)">' +
        '<span>⭐ Reviews Written</span>' +
        '<span class="admin-reviews-chevron" style="transition:transform 0.2s;display:inline-block">▼</span>' +
      '</button>' +
      '<div class="admin-reviews-body" style="display:none;padding:12px;flex-direction:column;gap:8px" id="admin-reviews-body-' + u.id + '">' +
        '<div style="font-size:13px;color:var(--bark-light);text-align:center;padding:8px">Loading…</div>' +
      '</div>' +
    '</div>' +
    '<div style="display:flex;gap:8px;margin-top:18px">' +
      '<button class="btn-outline" style="flex:1;padding:12px;color:var(--bark-light);border-color:var(--sand);font-size:13px" onclick="openAdminEditUser(' + u.id + ');closeAdminDetailPanel()">✏️ Edit</button>' +
      '<button class="btn-outline" style="flex:1;padding:12px;color:#e53935;border-color:#e53935;font-size:13px" onclick="adminRemoveUser(' + u.id + ');closeAdminDetailPanel()">🗑 Remove</button>' +
    '</div>';

  document.getElementById('admin-detail-panel').classList.add('open');
}

function closeAdminDetailPanel() {
  document.getElementById('admin-detail-panel').classList.remove('open');
}

async function toggleAdminReviews(btn, userId) {
  const body    = btn.nextElementSibling;
  const chevron = btn.querySelector('.admin-reviews-chevron');
  const isOpen  = body.style.display === 'flex';
  if (isOpen) {
    body.style.display = 'none';
    if (chevron) chevron.style.transform = '';
    return;
  }
  body.style.display = 'flex';
  if (chevron) chevron.style.transform = 'rotate(180deg)';

  // Load reviews if not yet loaded
  if (body.dataset.loaded === 'true') return;
  body.dataset.loaded = 'true';
  body.innerHTML = '<div style="font-size:13px;color:var(--bark-light);text-align:center;padding:8px;width:100%">Loading…</div>';
  try {
    const reviews = await api.getAdminUserReviews(userId);
    if (reviews.length === 0) {
      body.innerHTML = '<div style="font-size:13px;color:var(--bark-light);text-align:center;padding:8px;width:100%">No reviews written yet.</div>';
      return;
    }
    body.innerHTML = reviews.map(r => {
      const stars = '★'.repeat(r.stars) + '☆'.repeat(5 - r.stars);
      const date  = new Date(r.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
      return '<div id="admin-review-row-' + r.id + '" style="display:flex;align-items:flex-start;gap:8px;padding:8px;border-radius:8px;background:white;border:1px solid var(--sand-light);width:100%">' +
        '<div style="flex:1;min-width:0">' +
          '<div style="display:flex;align-items:center;gap:6px;margin-bottom:2px">' +
            '<span style="font-size:12px;font-weight:600;color:var(--terra)">' + escapeHTML(r.minderName) + '</span>' +
            '<span style="color:#f5a623;font-size:12px">' + stars + '</span>' +
          '</div>' +
          '<p style="font-size:12px;color:var(--bark);margin:0 0 2px;line-height:1.4">"' + escapeHTML(r.text) + '"</p>' +
          '<span style="font-size:11px;color:var(--bark-light)">' + date + '</span>' +
        '</div>' +
        '<button onclick="adminDeleteReviewItem(' + r.id + ')" style="background:none;border:none;color:#e53935;font-size:17px;cursor:pointer;flex-shrink:0;padding:2px 4px" title="Delete">🗑</button>' +
      '</div>';
    }).join('');
  } catch {
    body.innerHTML = '<div style="font-size:13px;color:var(--bark-light);text-align:center;padding:8px;width:100%">Could not load reviews.</div>';
  }
}

async function adminDeleteReviewItem(reviewId) {
  try {
    await api.adminDeleteReview(reviewId);
    const row = document.getElementById('admin-review-row-' + reviewId);
    if (row) row.remove();
    showToast('✅ Review deleted');
  } catch (err) {
    showToast('❌ ' + (err.message || 'Could not delete review'));
  }
}

function toggleAdminQuals(btn) {
  const body = btn.nextElementSibling;
  const chevron = btn.querySelector('.quals-chevron');
  const isOpen = body.style.display === 'flex';
  body.style.display = isOpen ? 'none' : 'flex';
  if (chevron) chevron.style.transform = isOpen ? '' : 'rotate(180deg)';
}

async function adminDismissPending(userId) {
  try {
    await api.updateAdminUser(userId, { pendingServices: [] });
    const u = adminUsers.find(x => x.id === userId);
    if (u) u.pendingServices = [];
    showToast('✅ Pending applications dismissed');
    openAdminUserDetail(userId);
    renderAdminPanels();
  } catch (err) {
    showToast('❌ ' + (err.message || 'Could not dismiss'));
  }
}

async function adminDeleteQual(userId, imageId) {
  showConfirmModal('🗑', 'Delete Qualification?', 'This will permanently remove this qualification image.', async function() {
    try {
      await api.adminDeleteQualification(userId, imageId);
      // Update local cache and re-render panel
      const u = adminUsers.find(x => x.id === userId);
      if (u) u.qualificationImages = (u.qualificationImages || []).filter(q => q.id !== imageId);
      showToast('✅ Qualification deleted');
      openAdminUserDetail(userId);
    } catch (err) {
      showToast('❌ ' + (err.message || 'Failed to delete qualification'));
    }
  });
}

async function adminToggleService(userId, service, enabled) {
  try {
    const result = await api.toggleAdminService(userId, service, enabled);
    const u = adminUsers.find(x => x.id === userId);
    if (u) {
      u.enabledServices = result.enabledServices;
      if (result.pendingServices !== undefined) u.pendingServices = result.pendingServices;
      // When disabling, the backend also cleans the services string — sync that too
      if (!enabled && result.services !== undefined) u.services = result.services;
    }
    showToast((enabled ? '✅ ' : '🚫 ') + service + (enabled ? ' enabled' : ' disabled') + ' for ' + (u ? u.name : 'minder'));
    openAdminUserDetail(userId); // re-render panel with updated toggles
  } catch (err) {
    showToast('❌ ' + (err.message || 'Failed to update service'));
    openAdminUserDetail(userId); // revert visual state
  }
}

function openAdminServicePanel(userId) { openAdminUserDetail(userId); }

function renderAdminPanels() {
  // Users panel
  const usersPanel = document.getElementById('admin-users');
  if (usersPanel) {
    usersPanel.innerHTML = '<div class="admin-section-title">Registered Users (' + adminUsers.length + ')</div>';
    if (adminUsers.length === 0) {
      usersPanel.innerHTML += '<div style="padding:20px;text-align:center;color:var(--bark-light);font-size:13px">No registered users.</div>';
    }
    adminUsers.forEach(u => {
      const card = document.createElement('div'); card.className = 'admin-user-card'; card.id = 'admin-card-' + u.id;
      card.style.cursor = 'pointer';
      const statusBadge = u.status === 'Active' ? '' : ' <span style="color:#e53935;font-size:11px">(' + u.status + ')</span>';
      const isMinder = u.rawRoles ? u.rawRoles.includes('minder') : u.role.toLowerCase().includes('minder');
      const minderBadge = isMinder ? ' <span style="background:var(--terra);color:white;font-size:10px;padding:2px 6px;border-radius:8px;margin-left:4px">Minder</span>' : '';
      const hasPending = isMinder && Array.isArray(u.pendingServices) && u.pendingServices.length > 0;
      const hasQuals   = isMinder && Array.isArray(u.qualificationImages) && u.qualificationImages.length > 0;
      const needsAttention = hasPending || hasQuals;
      const avatar = u.profileImage
        ? '<img src="' + u.profileImage + '" alt="" style="width:38px;height:38px;border-radius:50%;object-fit:cover">'
        : '<span style="font-size:22px">' + (u.avatar || '👤') + '</span>';
      const avatarWrapper =
        '<div style="position:relative;flex-shrink:0">' +
          avatar +
          (needsAttention ? '<span style="position:absolute;top:0;right:0;width:10px;height:10px;background:#f5a623;border-radius:50%;border:2px solid white" title="Needs review"></span>' : '') +
        '</div>';
      card.innerHTML =
        '<div class="admin-user-avatar">' + avatarWrapper + '</div>' +
        '<div class="admin-user-info"><div class="admin-user-name">' + u.name + statusBadge + minderBadge + '</div>' +
        '<div class="admin-user-role">' + u.role + ' · ' + u.email + '</div></div>' +
        '<div class="admin-user-actions">' +
          (isMinder ? '<button class="admin-btn edit" onclick="event.stopPropagation();openAdminServicePanel(' + u.id + ')">🛎 Services</button>' : '') +
          '<button class="admin-btn edit" onclick="event.stopPropagation();openAdminEditUser(' + u.id + ')">✏️ Edit</button>' +
          (u.status === 'Suspended'
            ? '<button class="admin-btn edit" style="background:#e8f5e9;color:#2e7d32;border-color:#a5d6a7" onclick="event.stopPropagation();adminUnsuspendUser(' + u.id + ')">▶ Unsuspend</button>'
            : '<button class="admin-btn suspend" onclick="event.stopPropagation();adminSuspendUser(' + u.id + ')">⏸ Suspend</button>') +
          '<button class="admin-btn remove" onclick="event.stopPropagation();adminRemoveUser(' + u.id + ')">🗑 Remove</button>' +
        '</div>';
      card.onclick = function() { openAdminUserDetail(u.id); };
      usersPanel.appendChild(card);
    });
  }
  // Disputes panel — only show Open disputes
  const disputesPanel = document.getElementById('admin-disputes');
  if (disputesPanel) {
    const open = adminDisputes.filter(d => d.status === 'Open');
    disputesPanel.innerHTML = '<div class="admin-section-title">Open Disputes (' + open.length + ')</div>';
    if (open.length === 0) {
      disputesPanel.innerHTML += '<div style="padding:20px;text-align:center;color:var(--bark-light);font-size:13px">No open disputes.</div>';
    }
    open.forEach(d => {
      const card = document.createElement('div'); card.className = 'dispute-card'; card.dataset.id = d.id;
      card.innerHTML = '<div class="dispute-header"><span class="dispute-badge open">' + d.status + '</span><span class="dispute-date">' + d.date + '</span></div><div class="dispute-body"><p><strong>Reported by:</strong> ' + d.from + '</p><p><strong>Against:</strong> ' + d.against + '</p><p><strong>Reason:</strong> ' + d.reason + '</p></div><div class="dispute-actions"><button class="admin-btn edit" onclick="resolveDispute(' + d.id + ')">✅ Resolve</button><button class="admin-btn remove" onclick="dismissDispute(' + d.id + ')">Dismiss</button></div>';
      disputesPanel.appendChild(card);
    });
  }
}

// Tab switching + persistence via sessionStorage
function switchAdminTab(btn, panelId) {
  document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  document.querySelectorAll('.admin-panel').forEach(p => p.style.display = 'none');
  document.getElementById(panelId).style.display = 'block';
  sessionStorage.setItem('pawpal_admin_tab', panelId);
}

function restoreAdminTab() {
  const saved = sessionStorage.getItem('pawpal_admin_tab');
  if (!saved) return;
  const panel = document.getElementById(saved);
  if (!panel) return;
  document.querySelectorAll('.admin-panel').forEach(p => p.style.display = 'none');
  panel.style.display = 'block';
  document.querySelectorAll('.admin-tab').forEach(t => {
    t.classList.toggle('active', t.getAttribute('onclick').includes(saved));
  });
}

// ── User CRUD ──
let adminEditingId = null;
function openAdminEditUser(userId) {
  adminEditingId = userId;
  const user = adminUsers.find(u => u.id === userId); if (!user) return;
  document.getElementById('admin-edit-title').textContent = 'Edit ' + user.name;
  document.getElementById('admin-edit-name').value = user.name;
  document.getElementById('admin-edit-email').value = user.email;
  document.getElementById('admin-edit-role').value = user.role;
  document.getElementById('admin-edit-status').value = user.status || 'Active';
  document.getElementById('admin-edit-modal').classList.add('open');
}
function closeAdminEditModal() { document.getElementById('admin-edit-modal').classList.remove('open'); }

async function saveAdminEdit() {
  if (!adminEditingId) return;
  try {
    const updated = await api.updateAdminUser(adminEditingId, {
      name:   document.getElementById('admin-edit-name').value.trim(),
      email:  document.getElementById('admin-edit-email').value.trim(),
      role:   document.getElementById('admin-edit-role').value,
      status: document.getElementById('admin-edit-status').value
    });
    const idx = adminUsers.findIndex(u => u.id === adminEditingId);
    if (idx !== -1) adminUsers[idx] = updated;
    closeAdminEditModal();
    showToast('✅ User profile updated');
    renderAdminPanels();
  } catch (err) {
    showToast('❌ ' + (err.message || 'Failed to update user'));
  }
}

function adminSuspendUser(userId) {
  showConfirmModal('⏸', 'Suspend User?', 'This user will be unable to log in. You can unsuspend them at any time.', async function() {
    try {
      const updated = await api.updateAdminUser(userId, { status: 'Suspended' });
      const idx = adminUsers.findIndex(u => u.id === userId);
      if (idx !== -1) adminUsers[idx] = updated;
      showToast('⏸ User account suspended');
      renderAdminPanels();
    } catch (err) {
      showToast('❌ ' + (err.message || 'Failed to suspend user'));
    }
  });
}

function adminUnsuspendUser(userId) {
  showConfirmModal('▶', 'Unsuspend User?', 'This user will be able to log in again.', async function() {
    try {
      const updated = await api.updateAdminUser(userId, { status: 'Active' });
      const idx = adminUsers.findIndex(u => u.id === userId);
      if (idx !== -1) adminUsers[idx] = updated;
      showToast('✅ User account reactivated');
      renderAdminPanels();
    } catch (err) {
      showToast('❌ ' + (err.message || 'Failed to unsuspend user'));
    }
  });
}

function adminRemoveUser(userId) {
  showConfirmModal('🗑', 'Remove User?', 'Permanently remove this account and all their data? This cannot be undone.', async function() {
    try {
      await api.deleteAdminUser(userId);
      adminUsers = adminUsers.filter(u => u.id !== userId);
      showToast('🗑 User account permanently removed');
      renderAdminPanels();
    } catch (err) {
      showToast('❌ ' + (err.message || 'Failed to remove user'));
    }
  });
}

// ── Dispute actions ──
async function resolveDispute(disputeId) {
  showConfirmModal('✅', 'Resolve Dispute?', 'Mark this dispute as resolved?', async function() {
    try {
      await api.updateDispute(disputeId, { status: 'Resolved' });
      const d = adminDisputes.find(x => x.id === disputeId);
      if (d) d.status = 'Resolved';
      showToast('✅ Dispute resolved');
      renderAdminPanels();
    } catch (err) {
      showToast('❌ ' + (err.message || 'Failed to resolve dispute'));
    }
  });
}

async function dismissDispute(disputeId) {
  showConfirmModal('🗑', 'Dismiss Dispute?', 'Dismiss this dispute without action?', async function() {
    try {
      await api.updateDispute(disputeId, { status: 'Dismissed' });
      const d = adminDisputes.find(x => x.id === disputeId);
      if (d) d.status = 'Dismissed';
      showToast('🗑 Dispute dismissed');
      renderAdminPanels();
    } catch (err) {
      showToast('❌ ' + (err.message || 'Failed to dismiss dispute'));
    }
  });
}


// ===== CHAT SYSTEM =====
async function loadAllBookingsForUser() {
  const owned = await api.getBookings().catch(() => []);
  let received = [];
  if (userProfile.role === 'minder') {
    received = await api.getBookingRequests().catch(() => []);
    received = received.map(b => Object.assign({}, b, { _recipient: true }));
  }
  // Dedupe in case a user is somehow both owner and minder of the same row
  const seen = new Set(owned.map(b => b.id));
  const merged = owned.concat(received.filter(b => !seen.has(b.id)));
  return merged;
}

// Render a minder's picture as either an emoji/glyph or an <img> if we have
// a real data-URI profile image stored on the booking. Falls back to the
// default 👤 glyph if nothing sensible is available.

function notifIcon(type) {
  switch (type) {
    case 'booking_request':   return '📩';
    case 'booking_confirmed': return '✅';
    case 'booking_declined':  return '❌';
    case 'booking_reminder':  return '⏰';
    case 'dispute_outcome':   return '⚖️';
    default:                  return '🔔';
  }
}

function notifAction(n) {
  if (n.type === 'booking_request') return "window.location.href='bookings.html?tab=requests'";
  return 'handleOwnerNotifClick(' + n.id + ')';
}

function availSlotForTime(timeStr) {
  const m = String(timeStr || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]) + Number(m[2]) / 60;
  for (const [key, r] of Object.entries(AVAIL_SLOT_RANGES)) {
    if (h >= r.start && h < r.end) return key;
  }
  return null;
}

function availDayForDate(dateStr) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateStr || ''))) return null;
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return AVAIL_DAY_KEYS[dt.getUTCDay()];
}
// Pure check used both by the time-grid renderer and the pre-submit guard.
// Returns { ok: true } or { ok: false, reason: string }.
// `minder.availability` is the per-day object { mon: ['morning','evening'], ... }

function checkMinderAvailability(minder, bookingDate, bookingTime) {
  if (!minder) return { ok: false, reason: 'Minder not found' };
  if (typeof minder.id !== 'number') return { ok: true }; // legacy demo minder
  const avail = (minder.availability && typeof minder.availability === 'object') ? minder.availability : {};
  if (!Object.keys(avail).length) {
    return { ok: false, reason: 'This minder has not published their availability yet' };
  }
  const day = availDayForDate(bookingDate);
  if (!day) return { ok: false, reason: 'Invalid booking date' };
  const daySlots = Array.isArray(avail[day]) ? avail[day] : [];
  if (!daySlots.length) {
    return { ok: false, reason: 'This minder is not available on ' + (AVAIL_DAY_LABELS[day] || day) };
  }
  const slot = availSlotForTime(bookingTime);
  if (!slot) return { ok: false, reason: 'Booking time is outside working hours' };
  if (!daySlots.includes(slot)) {
    return { ok: false, reason: 'This minder is not available in the ' + slot + ' on the selected date' };
  }
  return { ok: true };
}

async function initMinderPage() {
  const params = new URLSearchParams(window.location.search);
  const raw    = params.get('id');
  if (!raw) {
    document.getElementById('mp-name').textContent = 'Minder not found';
    return;
  }
  const numericId = Number(raw);
  let minder = null;
  try {
    if (!loadedMinders.length) loadedMinders = await api.getMinders();
    if (!Number.isNaN(numericId)) {
      minder = loadedMinders.find(m => m.id === numericId) || null;
    }
  } catch { /* silent */ }
  if (!minder) {
    document.getElementById('mp-name').textContent = 'Minder not found';
    return;
  }
  currentMinderId      = minder.id;
  currentReviewMinder  = minder.id;
  renderMinderProfileInto(minder);
  // Wire the Book Now button — only owners can book
  const bookBtn = document.getElementById('mp-book-btn');
  const _mpRoles = Array.isArray(userProfile.role) ? userProfile.role : [userProfile.role || ''];
  const _canBook = _mpRoles.includes('owner') && String(minder.id) !== String(store.currentUserId());
  if (bookBtn) {
    if (_canBook && typeof minder.id === 'number') {
      bookBtn.style.display = '';
      bookBtn.onclick = function () { window.location.href = 'active-booking.html?minder=' + minder.id; };
    } else {
      bookBtn.style.display = 'none';
    }
  }
  // Wire the Message button
  const msgBtn = document.getElementById('mp-msg-btn');
  if (msgBtn && typeof minder.id === 'number') {
    msgBtn.onclick = function () { messageMinder(minder.id); };
  }
  await loadMinderReviews(minder.id);
}

function renderMinderProfileInto(minder) {
  // Stash the currently-viewed minder as the default report target so the
  // "🚩 Report" button in the hero can pick it up without extra state plumbing.
  const _rptRoles = Array.isArray(userProfile.role) ? userProfile.role : [userProfile.role || ''];
  const canReport = minder && typeof minder.id === 'number' && _rptRoles.includes('owner') && String(minder.id) !== String(store.currentUserId());
  currentReportTarget = canReport ? {
    targetUserId: minder.id,
    targetName:   minder.name,
    targetRole:   'minder',
    context:      'minder-profile'
  } : null;
  const reportBtn = document.getElementById('mp-report-btn');
  if (reportBtn) reportBtn.style.display = canReport ? 'inline-block' : 'none';
  if (!minder) return;
  const mpAvatar = document.getElementById('mp-avatar');
  if (mpAvatar) {
    if (minder.profileImage) {
      mpAvatar.innerHTML = '<img src="' + minder.profileImage + '" alt="avatar" class="avatar-img" style="width:100%;height:100%;object-fit:cover;border-radius:50%">';
    } else {
      mpAvatar.textContent = minder.avatar || '👤';
    }
  }
  const nameEl = document.getElementById('mp-name'); if (nameEl) nameEl.textContent = minder.name;
  const locEl  = document.getElementById('mp-loc');  if (locEl)  locEl.textContent  = minder.location ? '📍 ' + minder.location : (minder.loc || '');
  const bioEl  = document.getElementById('mp-bio');  if (bioEl)  bioEl.textContent  = minder.bio || '';

  const details = document.getElementById('mp-details');
  const isRealMinder = typeof minder.id === 'number';
  if (details && (isRealMinder || minder.experience || minder.petsCaredFor || minder.services || minder.rate || minder.priceMin != null)) {
    let html = '';
    if (minder.experience)   html += '<div class="info-row"><span class="info-label">Experience</span><span class="info-value">' + escapeHTML(minder.experience) + '</span></div>';
    if (minder.petsCaredFor) html += '<div class="info-row"><span class="info-label">Pets accepted</span><span class="info-value">' + escapeHTML(minder.petsCaredFor) + '</span></div>';
    if (minder.services)     html += '<div class="info-row"><span class="info-label">Services</span><span class="info-value">' + escapeHTML(minder.services) + '</span></div>';
    const priceStr = (minder.priceMin != null && minder.priceMax != null) ? '£' + minder.priceMin + ' – £' + minder.priceMax + '/hr' : (minder.rate || '');
    if (priceStr) html += '<div class="info-row"><span class="info-label">Rate</span><span class="info-value">' + escapeHTML(priceStr) + '</span></div>';
    const certTags = Array.isArray(minder.certificationTags) ? minder.certificationTags : [];
    if (certTags.length) {
      html += '<div class="info-row" style="flex-direction:column;align-items:flex-start;gap:6px"><span class="info-label">Certifications</span>' +
        '<div style="display:flex;flex-wrap:wrap;gap:6px">' +
        certTags.map(t => '<span style="background:var(--sand-light);color:var(--bark);border-radius:20px;padding:4px 12px;font-size:12px;font-weight:500">' + escapeHTML(t) + '</span>').join('') +
        '</div></div>';
    }
    if (!html && isRealMinder) html = '<p style="font-size:13px;color:var(--bark-light);text-align:center;padding:8px 0">This minder hasn\'t added service details yet.</p>';
    details.innerHTML = html;
  }
  renderMinderAvailability(minder);
}

// Tracks which minder is currently being viewed on minder.html so submitReview
// knows where to attach the review the user just wrote.

async function loadMinderReviews(minderId) {
  const list = document.getElementById('minder-reviews-list');
  if (!list) return;
  if (typeof minderId !== 'number') {
    list.innerHTML = '<div style="background:white;border-radius:var(--radius);padding:18px;box-shadow:0 2px 12px var(--shadow);text-align:center;color:var(--bark-light);font-size:13px">Reviews are only available for verified minders.</div>';
    updateMinderStarsSummary([]);
    return;
  }
  try {
    const { reviews, average, count } = await api.getMinderReviews(minderId);
    renderMinderReviews(reviews);
    updateMinderStarsSummary(reviews);
  } catch {
    list.innerHTML = '<div style="background:white;border-radius:var(--radius);padding:18px;box-shadow:0 2px 12px var(--shadow);text-align:center;color:var(--bark-light);font-size:13px">Could not load reviews.</div>';
  }
}

function renderMinderReviews(reviews) {
  const list = document.getElementById('minder-reviews-list');
  if (!list) return;

  const myId = String(store.currentUserId());

  const reviewCards = reviews.length
    ? reviews.map(r => {
        const stars = '★'.repeat(r.rating || r.stars || 0) + '☆'.repeat(5 - (r.rating || r.stars || 0));
        const when  = formatChatTime(r.createdAt);
        const isOwn = String(r.reviewerId) === myId;
        const deleteBtn = isOwn
          ? '<button onclick="deleteMyReview(' + r.id + ')" style="background:none;border:none;color:#e53935;font-size:18px;cursor:pointer;padding:0;line-height:1" title="Delete review">🗑</button>'
          : '';
        return '<div id="review-card-' + r.id + '" style="background:white;border-radius:var(--radius);padding:18px;box-shadow:0 2px 12px var(--shadow)">'
          + '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">'
          + '<div><strong style="font-size:14px">' + escapeHTML(r.authorName || r.reviewerName || 'User') + '</strong>'
          + '<span style="color:#f5a623;margin-left:8px">' + stars + '</span></div>'
          + deleteBtn + '</div>'
          + '<p style="font-size:13px;color:var(--bark-light);line-height:1.6">"' + escapeHTML(r.text) + '"</p>'
          + '<p style="font-size:11px;color:var(--bark-light);margin-top:8px">' + when + '</p></div>';
      }).join('')
    : '<div style="background:white;border-radius:var(--radius);padding:18px;box-shadow:0 2px 12px var(--shadow);text-align:center;color:var(--bark-light);font-size:13px">No reviews yet.</div>';

  list.innerHTML = reviewCards;
  reviewStars = 0;
}

async function deleteMyReview(reviewId) {
  showConfirmModal('🗑', 'Delete Review?', 'This will permanently remove your review.', async function() {
    try {
      await api.deleteReview(reviewId);
      const card = document.getElementById('review-card-' + reviewId);
      if (card) card.remove();
      // Refresh star summary
      const { reviews, average, count } = await api.getMinderReviews(currentReviewMinder);
      updateMinderStarsSummary(reviews);
      showToast('✅ Review deleted');
    } catch (err) {
      showToast('❌ ' + (err.message || 'Could not delete review'));
    }
  });
}

function updateMinderStarsSummary(reviews) {
  const starsEl = document.getElementById('mp-stars');
  if (!starsEl) return;
  if (!reviews || !reviews.length) {
    starsEl.innerHTML = '☆☆☆☆☆ <span style="font-size:13px;opacity:0.8">(no reviews yet)</span>';
    return;
  }
  const avg = reviews.reduce((s, r) => s + (r.stars || r.rating || 0), 0) / reviews.length;
  const rounded = Math.round(avg);
  const stars = '★'.repeat(rounded) + '☆'.repeat(5 - rounded);
  starsEl.innerHTML = stars + ' <span style="font-size:13px;opacity:0.8">(' + reviews.length + ' review' + (reviews.length === 1 ? '' : 's') + ')</span>';
}

// Render the minder's availability tab from their saved arrays. Falls back
// to a "not set" grid/message when a minder hasn't configured anything yet.

function renderMinderAvailability(minder) {
  const grid  = document.getElementById('mp-avail-grid');
  const slots = document.getElementById('mp-avail-slots');
  if (!grid || !slots) return;

  const avail = (minder.availability && typeof minder.availability === 'object') ? minder.availability : {};
  const isRealMinder = typeof minder.id === 'number';

  const DAY_DEFS = [
    { key: 'mon', label: 'M' }, { key: 'tue', label: 'T' }, { key: 'wed', label: 'W' },
    { key: 'thu', label: 'T' }, { key: 'fri', label: 'F' }, { key: 'sat', label: 'S' },
    { key: 'sun', label: 'S' }
  ];
  const DAY_FULL = { mon:'Monday', tue:'Tuesday', wed:'Wednesday', thu:'Thursday', fri:'Friday', sat:'Saturday', sun:'Sunday' };
  const SLOT_LABELS = { morning: 'Morning (8–12)', afternoon: 'Afternoon (12–5)', evening: 'Evening (5–8)' };

  grid.innerHTML = DAY_DEFS.map(d => {
    const on = isRealMinder ? Array.isArray(avail[d.key]) && avail[d.key].length > 0 : true;
    return '<div class="avail-day ' + (on ? 'available' : 'busy') + '"><div>' + d.label + '</div><div>' + (on ? '✓' : '–') + '</div></div>';
  }).join('');

  // Per-day slot breakdown
  if (isRealMinder && Object.keys(avail).length) {
    slots.innerHTML = DAY_DEFS.filter(d => Array.isArray(avail[d.key]) && avail[d.key].length)
      .map(d => {
        const slotLabels = avail[d.key].map(s => SLOT_LABELS[s] || s).join(', ');
        return '<div class="info-row"><span class="info-label">' + DAY_FULL[d.key] + '</span><span class="info-value">' + slotLabels + '</span></div>';
      }).join('');
  } else if (isRealMinder) {
    slots.innerHTML = '<p style="font-size:13px;color:var(--bark-light);text-align:center;padding:8px 0">This minder hasn\'t set their availability yet.</p>';
  } else {
    // Legacy demo minders — show all slots on all days
    slots.innerHTML = Object.entries(SLOT_LABELS).map(([, label]) =>
      '<div class="info-row"><span class="info-label">' + label + '</span><span class="info-value">✅ Available</span></div>'
    ).join('');
  }
}

function formatChatTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toTimeString().slice(0, 5);
  const yest = new Date(now); yest.setDate(now.getDate() - 1);
  if (d.toDateString() === yest.toDateString()) return 'Yesterday';
  const diffDays = Math.floor((now - d) / 86400000);
  if (diffDays < 7) return ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getDay()];
  return String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0');
}

function formatMsgTime(iso) {
  if (!iso) return '';
  const d = new Date(iso); if (isNaN(d.getTime())) return '';
  return d.toTimeString().slice(0, 5);
}

function chatAvatarHTML(other) {
  if (other && other.avatar) {
    return '<img class="avatar-img" src="' + other.avatar + '" alt="">';
  }
  return '🧑';
}

async function loadChatList() {
  const list = document.getElementById('chat-list');
  if (!list) return;
  try {
    const chats = await api.getChats();
    chatListCache = chats;
    renderChatList();
  } catch {
    list.innerHTML = '<div style="padding:24px;text-align:center;color:var(--bark-light);font-size:13px">Could not load chats.</div>';
  }
}

function renderChatList() {
  const list = document.getElementById('chat-list');
  if (!list) return;
  if (!chatListCache.length) {
    list.innerHTML = '<div style="padding:24px;text-align:center;color:var(--bark-light);font-size:13px">No conversations yet.<br>Accept a booking or message a minder to start.</div>';
    return;
  }
  list.innerHTML = chatListCache.map(c => {
    const activeCls = activeChat === c.id ? ' active-chat' : '';
    const unread = (c.unread && activeChat !== c.id) ? '<div class="chat-unread">' + c.unread + '</div>' : '';
    // Green dot for online counterparts, grey dot for offline. The CSS class
    // .chat-online already paints green; offline gets an inline grey override.
    const presenceDot = c.other.online
      ? '<div class="chat-online"></div>'
      : '<div class="chat-online" style="background:#9e9e9e"></div>';
    return '<div class="chat-item' + activeCls + '" data-chat-id="' + c.id + '" onclick="openChatInline(' + c.id + ')">'
      + '<div class="chat-avatar">' + chatAvatarHTML(c.other) + presenceDot + '</div>'
      + '<div class="chat-info"><div class="chat-name">' + (c.other.name || 'User') + '</div>'
      + '<div class="chat-preview">' + (c.lastPreview || 'No messages yet') + '</div></div>'
      + '<div class="chat-meta"><div class="chat-time">' + formatChatTime(c.lastMessageAt) + '</div>' + unread + '</div>'
      + '</div>';
  }).join('');
}

function selectRatingFilter(el) {
  const wasActive = el.classList.contains('active');
  document.querySelectorAll('#filter-rating .filter-opt').forEach(o => o.classList.remove('active'));
  if (!wasActive) el.classList.add('active');
}

// Location search bar — triggered by the Go button or Enter key

function openReportMinderModal() {
  if (!currentReportTarget || currentReportTarget.targetRole !== 'minder') {
    showToast('❌ Unable to report this profile');
    return;
  }
  openReportModalWith(currentReportTarget);
}

function openReportFromChat() {
  if (!activeChat) { showToast('❌ Open a chat first'); return; }
  const chat = chatListCache.find(c => c.id === activeChat);
  if (!chat || !chat.other) { showToast('❌ Unable to report this chat'); return; }
  currentReportTarget = {
    targetUserId: chat.other.id,
    targetName:   chat.other.name,
    targetRole:   null,
    context:      'chat',
    chatId:       activeChat
  };
  openReportModalWith(currentReportTarget);
}

function openReportCustomerModal(bookingId, ownerId, ownerName) {
  currentReportTarget = {
    targetUserId: ownerId,
    targetName:   ownerName,
    targetRole:   'owner',
    context:      'booking',
    bookingId:    bookingId
  };
  openReportModalWith(currentReportTarget);
}

function openReportModalWith(target) {
  const modal = document.getElementById('report-modal');
  if (!modal) { showToast('❌ Report form unavailable on this page'); return; }
  const roleLabel = target.targetRole === 'minder' ? 'Pet Minder' : (target.targetRole === 'owner' ? 'Pet Owner' : '');
  const targetEl  = document.getElementById('report-modal-target');
  const titleEl   = document.getElementById('report-modal-title');
  const reasonEl  = document.getElementById('report-modal-reason');
  const catEl     = document.getElementById('report-modal-category');
  if (titleEl)  titleEl.textContent = '🚩 Report ' + (roleLabel || 'User');
  if (targetEl) targetEl.textContent = 'Reporting: ' + (target.targetName || 'Unknown') + (roleLabel ? ' (' + roleLabel + ')' : '');
  if (reasonEl) reasonEl.value = '';
  if (catEl)    catEl.selectedIndex = 0;
  modal.classList.add('open');
}

function closeReportModal() {
  const modal = document.getElementById('report-modal');
  if (modal) modal.classList.remove('open');
}

async function submitReportModal() {
  if (!currentReportTarget) { showToast('❌ No user selected'); return; }
  const reasonEl = document.getElementById('report-modal-reason');
  const catEl    = document.getElementById('report-modal-category');
  const reason   = (reasonEl && reasonEl.value || '').trim();
  const category = (catEl && catEl.value || '').trim();
  if (!reason) { showToast('❌ Please describe what happened'); return; }
  const fullReason = category ? ('[' + category + '] ' + reason) : reason;
  try {
    await api.createDispute({
      reason:       fullReason,
      targetUserId: currentReportTarget.targetUserId,
      targetName:   currentReportTarget.targetName,
      targetRole:   currentReportTarget.targetRole,
      context:      currentReportTarget.context,
      bookingId:    currentReportTarget.bookingId,
      chatId:       currentReportTarget.chatId
    });
    showToast('✅ Report submitted. Our team will review it.');
    closeReportModal();
  } catch (err) {
    showToast('❌ ' + (err.message || 'Failed to submit report'));
  }
}

function getSelectedChipsArray(containerId) {
  const el = document.getElementById(containerId);
  if (!el) return [];
  return Array.from(el.querySelectorAll('.chip-btn.active')).map(b => b.getAttribute('data-value'));
}

function setSelectedChipsArray(containerId, arr) {
  const el = document.getElementById(containerId);
  if (!el) return;
  const vals = (Array.isArray(arr) ? arr : []).map(v => String(v).toLowerCase());
  el.querySelectorAll('.chip-btn').forEach(b => {
    b.classList.toggle('active', vals.includes(b.getAttribute('data-value').toLowerCase()));
  });
}
// Per-day availability grid helpers (edit profile modal).
// The grid is a set of .avail-day-row[data-day] elements, each containing
// .avail-slot-btn[data-value] chip buttons.

function loadAvailabilityGrid(avail) {
  const grid = document.getElementById('edit-avail-grid');
  if (!grid) return;
  grid.querySelectorAll('.avail-day-row').forEach(row => {
    const day = row.dataset.day;
    const slots = (avail && Array.isArray(avail[day])) ? avail[day] : [];
    row.querySelectorAll('.avail-slot-btn').forEach(btn => {
      btn.classList.toggle('active', slots.includes(btn.dataset.value));
    });
  });
}

function readAvailabilityGrid() {
  const grid = document.getElementById('edit-avail-grid');
  if (!grid) return {};
  const avail = {};
  grid.querySelectorAll('.avail-day-row').forEach(row => {
    const day = row.dataset.day;
    const slots = Array.from(row.querySelectorAll('.avail-slot-btn.active')).map(b => b.dataset.value);
    if (slots.length) avail[day] = slots;
  });
  return avail;
}

// Clamp price input value to 0–50

// ===== AVAILABILITY HELPERS =====
// ===== TOAST =====
function showToast(msg) {
  const t = document.getElementById('toast'); t.textContent = msg; t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2500);
}

// Initial render
refreshPetsUI();
if (document.getElementById('admin-users')) loadAdminData();
if (document.getElementById('minders-list')) loadMinders();
// Load notification count for minders on the profile page
if (document.getElementById('notif-badge')) loadNotificationCount();

// ===== AUTH GUARD =====
// Pages that require a valid session. auth.html and index.html are excluded.
const PROTECTED = ['home.html','search.html','bookings.html','messages.html','profile.html','admin.html','active-booking.html'];

document.addEventListener('DOMContentLoaded', async () => {
  const page = window.location.pathname.split('/').pop() || 'index.html';

  // Set currentScreen based on the loaded page so that back-navigation
  // from sub-screens (e.g. Reviews, Help Centre) returns to the correct parent.
  const pageToScreen = { 'home.html':'home', 'search.html':'search', 'bookings.html':'bookings', 'messages.html':'messages', 'profile.html':'profile' };
  if (pageToScreen[page]) currentScreen = pageToScreen[page];

  if (!PROTECTED.includes(page)) return;

  if (!api.getToken()) {
    window.location.href = 'auth.html';
    return;
  }

  // Refresh user profile from the server in the background.
  // If the token is expired the server returns 401 → redirect to login.
  try {
    // Server is the source of truth for BOTH profile and pets.
    // Fetch them in parallel, overwrite local cache, then re-render.
    const [user, pets] = await Promise.all([api.getMe(), api.getPets()]);

    hydrateUserProfile(user);
    store.setUser(userProfile);

    // Rebuild petData keyed by backend id, then mirror to localStorage so
    // the next page load can render synchronously before the fetch returns.
    petData = {};
    pets.forEach(p => { petData[p.id] = p; });
    store.setPets(petData);

    refreshPetsUI();
    // If we're on the active-booking page, re-render the picker with the
    // freshly-fetched pets.
    if (document.getElementById('booking-pet-list')) {
      renderBookingPetPicker();
      updateBookingSummary();
    }
  } catch {
    api.clearSession();
    window.location.href = 'auth.html';
  }
});
