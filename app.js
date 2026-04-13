let currentScreen = 'landing';
let previousScreen = null;
const appScreens = ['home', 'search', 'bookings', 'messages', 'profile'];
let isAdmin = false;
let selectedRole = 'owner';
let reviewStars = 0;
let profileReviewStars = 0;
let currentEditPetId = null;
let regPendingPets = []; // pets added during registration (before account exists)
let regPetNextId = 1;    // local counter for pending pet IDs
let regPendingCerts = []; // certifications added during registration (pet minder only)
let regCertNextId = 1;    // local counter for pending cert IDs
let currentReviewMinder = null;
let reportSelectedUser = null;
// In-context report target — populated when the user opens the report modal
// from the minder profile or from a booking card.
let currentReportTarget = null;

// User profile — populated from the session cache or API on page load
let userProfile = {
  firstName: '', lastName: '', email: '', phone: '', location: '', bio: '',
  role: 'owner', profileImage: '',
  // Minder-specific (blank for owners)
  serviceArea: '', petsCaredFor: '', services: '', rate: '', experience: '',
  priceMin: 0, priceMax: 50,
  availability: {}, certifications: ''
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
  logout()                  { return this._req('POST',   '/auth/logout'); },
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
  // Minders (public)
  getMinders()              { return this._req('GET',    '/minders'); },
  // Admin
  getAdminUsers()           { return this._req('GET',    '/admin/users'); },
  updateAdminUser(id, data) { return this._req('PATCH',  '/admin/users/' + id, data); },
  deleteAdminUser(id)       { return this._req('DELETE', '/admin/users/' + id); },
  getDisputes()             { return this._req('GET',    '/admin/disputes'); },
  createDispute(data)       { return this._req('POST',   '/admin/disputes', data); },
  updateDispute(id, data)   { return this._req('PATCH',  '/admin/disputes/' + id, data); },
  // Chats
  getChats()                { return this._req('GET',    '/chats'); },
  getChatMessages(id)       { return this._req('GET',    '/chats/' + id + '/messages'); },
  sendChatMessage(id, text) { return this._req('POST',   '/chats/' + id + '/messages', { text }); },
  createChat(otherUserId)   { return this._req('POST',   '/chats', { otherUserId }); },
  // Reviews
  getMinderReviews(minderId) { return this._req('GET',  '/reviews/' + minderId); },
  getReviewStats()           { return this._req('GET',  '/reviews/stats/all'); },
  createReview(data)         { return this._req('POST', '/reviews', data); },
};

// Hydrate userProfile from localStorage immediately (sync) so pages render
// the correct name before the async /me call completes.
function hydrateUserProfile(u) {
  if (!u) return;
  userProfile.firstName    = u.firstName    || '';
  userProfile.lastName     = u.lastName     || '';
  userProfile.email        = u.email        || '';
  userProfile.phone        = u.phone        || '';
  userProfile.location     = u.location     || '';
  userProfile.bio          = u.bio          || '';
  userProfile.role         = u.role         || 'owner';
  userProfile.profileImage = u.profileImage || '';
  userProfile.serviceArea  = u.serviceArea  || '';
  userProfile.petsCaredFor = u.petsCaredFor || '';
  userProfile.services     = u.services     || '';
  userProfile.rate         = u.rate         || '';
  userProfile.experience   = u.experience   || '';
  userProfile.priceMin     = u.priceMin != null ? u.priceMin : 0;
  userProfile.priceMax     = u.priceMax != null ? u.priceMax : 50;
  userProfile.availability = (u.availability && typeof u.availability === 'object' && !Array.isArray(u.availability))
    ? JSON.parse(JSON.stringify(u.availability)) : {};
  userProfile.certifications = u.certifications || '';
}
(function initUserFromCache() { hydrateUserProfile(store.getUser()); }());

// Minder data for profiles
const minderData = {
  sarah: { name: 'Sarah K.', avatar: '🧑‍🦱', stars: '★★★★★', reviews: 48, loc: '📍 Shoreditch, London · 0.8mi away', bio: "Hi! I'm Sarah, a passionate animal lover with 5 years of pet care experience. I specialise in dog walking and home visits. Your pet will be treated like royalty! 🐾" },
  james: { name: 'James M.', avatar: '👩‍🦰', stars: '★★★★☆', reviews: 32, loc: '📍 Hackney, London · 1.2mi away', bio: "Hello! I'm James. I love cats and have been caring for pets for 3 years. I offer home visits and cat sitting services." },
  emma:  { name: 'Emma T.',  avatar: '🧔',    stars: '★★★★★', reviews: 61, loc: '📍 Bethnal Green, London · 1.5mi away', bio: "I'm Emma, an experienced pet carer who loves all animals. I offer walking, grooming and home visits for dogs and cats." },
  priya: { name: 'Priya S.', avatar: '👨‍🦳', stars: '★★★★☆', reviews: 19, loc: '📍 Stepney, London · 1.8mi away', bio: "Hi, I'm Priya! I specialise in dog training and walking. I have a certificate in animal behaviour and love working with all breeds." }
};

// Previously booked minders (for review system)
const bookedMinders = [
  { id: 'sarah', name: 'Sarah K.', avatar: '🧑‍🦱', lastBooking: '7 Apr – Dog Walk' },
  { id: 'emma', name: 'Emma T.', avatar: '🧔', lastBooking: '9 Apr – Home Visit' },
  { id: 'james', name: 'James M.', avatar: '👩‍🦰', lastBooking: '20 Mar – Home Visit' }
];

// Booking lists are always fetched from `GET /api/bookings` (filtered by
// ownerId on the server). These empty arrays exist purely as a fallback
// shape for when the fetch fails — never populated with mock data, so a
// fresh account can't accidentally see another user's bookings.
const upcomingBookings = [];
const pastBookings = [];
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

// Fetch the current user's bookings from BOTH perspectives:
//   - owner side (api.getBookings): bookings they placed as a pet owner
//   - minder side (api.getBookingRequests): bookings placed against them
//     when they are a minder
// Minder-side rows are tagged with `_recipient: true` so the renderer can
// apply the light orange/yellow style and show the owner's name. We use
// real stored user ids (not UI state) so the result is identical after a
// page refresh.
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
  el.innerHTML = bookings.map(b => {
    // Recipient styling: when the logged-in user is the minder for this
    // booking (i.e. they are the recipient of the request, not the one
    // who placed it) we paint the card with a light orange/yellow tint.
    // The flag is computed from real stored ids, so it survives a refresh.
    const recipientCls = b._recipient ? ' recipient' : '';
    // For minder-side cards we show the pet owner's name (b.ownerName);
    // owner-side cards keep the existing minder name display.
    const headline = b._recipient ? (b.ownerName || 'Pet Owner') : (b.minderName || 'Minder');
    return `
    <div class="booking-card${recipientCls}" onclick="openBookingDetail(${b.id}, ${b._recipient})" style="cursor:pointer">
      <div class="booking-date-block"><div class="booking-date-day">${b.day}</div><div class="booking-date-month">${b.month}</div></div>
      <div class="booking-date-sep"></div>
      <div class="booking-avatar">${bookingAvatarHTML(b)}</div>
      <div class="booking-info">
        <div class="booking-minder">${headline}</div>
        <div class="booking-detail">${b.petEmoji} ${b.petDetail}</div>
        ${b.price ? `<div class="booking-detail" style="margin-top:4px;color:var(--terra)">${b.price}</div>` : ''}
      </div>
      <span class="booking-status status-${b.status}">${statusLabels[b.status] || b.status}</span>
    </div>`;
  }).join('');
}

function openBookingDetail(bookingId, recipientBool) {
  const b = allBookingsCache.find(x => x.id === bookingId);
  if (!b) return;
  const el = document.getElementById('booking-detail-content');
  if (!el) return;
  const canCancel = b.status === 'pending' || b.status === 'confirmed';
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
    (canCancel && recipientBool ? '<button class="btn-primary" style="width:100%;margin-top:20px;padding:14px;background:#008000">Confirm Completion</button>' : '') +
    (canCancel ? '<button class="btn-primary" style="width:100%;margin-top:20px;padding:14px;background:#e53935" onclick="cancelBooking(' + b.id + ')">Cancel Booking</button>' : '');
  document.getElementById('bookings-detail-section').style.display = 'block';
  document.getElementById('bookings-main-section').style.display = 'none';
}

function closeBookingDetail() {
  document.getElementById('bookings-detail-section').style.display = 'none';
  document.getElementById('bookings-main-section').style.display = 'block';
}

function cancelBooking(bookingId) {
  showConfirmModal('🗑', 'Cancel Booking?', 'Are you sure you want to cancel this booking? This cannot be undone.', async function() {
    try {
      await api.updateBooking(bookingId, { status: 'cancelled' });
      showToast('✅ Booking cancelled');
      closeBookingDetail();
      // Refresh bookings list
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

// ===== BOOKING REQUESTS (minder view) =====
async function loadBookingRequests() {
  const el = document.getElementById('bookings-requests-list');
  if (!el) return;
  el.innerHTML = '<div style="padding:20px;text-align:center;color:var(--bark-light);font-size:13px">Loading requests...</div>';
  try {
    // The Requests tab shows ONLY pending bookings where the logged-in
    // user is the minder. Once a booking is accepted it leaves Requests
    // and surfaces in Upcoming (with a recipient-tinted style), and
    // declined/cancelled bookings disappear from Requests entirely.
    const all = await api.getBookingRequests();
    const requests = all.filter(b => b.status === 'pending');
    if (requests.length === 0) {
      el.innerHTML = '<div style="padding:40px;text-align:center;color:var(--bark-light);font-size:14px">No booking requests yet.</div>';
      return;
    }
    el.innerHTML = requests.map(b => {
      // Safely escape the owner name for an inline onclick attribute:
      // strip double-quotes (would close the attribute) and escape single-
      // quotes (would terminate the JS string).
      const ownerNameAttr = String(b.ownerName || 'Pet Owner').replace(/"/g, '').replace(/'/g, "\\'");
      return `
      <div class="booking-card recipient" style="cursor:default;flex-wrap:wrap">
        <div class="booking-date-block"><div class="booking-date-day">${b.day}</div><div class="booking-date-month">${b.month}</div></div>
        <div class="booking-date-sep"></div>
        <div class="booking-avatar">${b.avatar}</div>
        <div class="booking-info">
          <div class="booking-minder">${b.ownerName || 'Pet Owner'}</div>
          <div class="booking-detail">${b.petEmoji} ${b.petDetail}</div>
          ${b.price ? '<div class="booking-detail" style="margin-top:4px;color:var(--terra)">' + b.price + '</div>' : ''}
        </div>
        <span class="booking-status status-${b.status}">${statusLabels[b.status] || b.status}</span>
        <div style="width:100%;display:flex;justify-content:flex-end;margin-top:8px">
          <button class="booking-report-btn" onclick="openReportCustomerModal(${b.id}, ${b.ownerId || 'null'}, '${ownerNameAttr}')">🚩 Report customer</button>
        </div>
        ${b.status === 'pending' ? '<div class="booking-request-actions" style="width:100%;display:flex;gap:8px;margin-top:10px;padding-left:62px"><button class="btn-primary" style="flex:1;padding:10px;font-size:13px" onclick="respondToBooking(' + b.id + ',\'confirmed\',this)">Accept</button><button class="btn-outline" style="flex:1;padding:10px;font-size:13px;color:var(--bark-light);border-color:var(--sand)" onclick="respondToBooking(' + b.id + ',\'declined\',this)">Decline</button></div>' : ''}
      </div>`;
    }).join('');
  } catch {
    el.innerHTML = '<div style="padding:40px;text-align:center;color:var(--bark-light);font-size:14px">Could not load requests.</div>';
  }
}

async function respondToBooking(bookingId, status, btnEl) {
  // Disable buttons to prevent double-click
  const row = btnEl.closest('.booking-request-actions');
  if (row) row.querySelectorAll('button').forEach(b => b.disabled = true);
  try {
    const updated = await api.updateBooking(bookingId, { status });
    showToast(status === 'confirmed' ? '✅ Booking accepted!' : '❌ Booking declined');
    // When the minder accepts, the backend creates (or reuses) a 1-on-1
    // chat with the pet owner and returns its id. Open the messages page
    // on that chat so the minder can message the owner immediately.
    if (status === 'confirmed' && updated && updated.chatId) {
      setTimeout(() => { window.location.href = 'messages.html?chat=' + updated.chatId; }, 400);
      return;
    }
    loadBookingRequests();        // refresh the requests list
    loadNotificationCount();      // update badge
    // Also refresh the owner-side Upcoming/Past lists on the same page so
    // a freshly-accepted booking immediately moves to Upcoming and a
    // declined one disappears from the active view.
    try {
      if (document.getElementById('bookings-upcoming-list')) {
        const bookings = await loadAllBookingsForUser();
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
let notifOwnerMessages = []; // owner: declined/other notifications from /api/notifications

async function loadNotificationCount() {
  try {
    // Both roles load from /api/notifications which now contains all
    // booking request, confirmation, decline, and reminder notifications.
    notifOwnerMessages = await api.getNotifications();
    notifCount = notifOwnerMessages.filter(n => !n.read).length;

    // Minders also need the requests list for the Bookings > Requests tab
    if (userProfile.role === 'minder') {
      notifRequests = await api.getBookingRequests();
    }

    const badge = document.getElementById('notif-badge');
    if (badge) {
      badge.textContent = notifCount;
      badge.style.display = notifCount > 0 ? 'inline-flex' : 'none';
    }
  } catch { /* silent */ }
}

function notifIcon(type) {
  switch (type) {
    case 'booking_request':   return '📩';
    case 'booking_confirmed': return '✅';
    case 'booking_declined':  return '❌';
    case 'booking_reminder':  return '⏰';
    default:                  return '🔔';
  }
}
function notifAction(n) {
  if (n.type === 'booking_request') return "window.location.href='bookings.html?tab=requests'";
  return 'handleOwnerNotifClick(' + n.id + ')';
}

function openNotifications() {
  previousScreen = currentScreen;
  const list = document.getElementById('notif-list');
  if (!list) { show('notifications'); currentScreen = 'notifications'; return; }

  if (!notifOwnerMessages || notifOwnerMessages.length === 0) {
    list.innerHTML = '<div style="padding:40px;text-align:center;color:var(--bark-light);font-size:14px">No notifications yet.</div>';
  } else {
    list.innerHTML = notifOwnerMessages.map(n => {
      const unread = !n.read;
      return '<div class="menu-item" style="' + (unread ? 'border-left:3px solid var(--terra);' : 'opacity:0.75;') + '" onclick="' + notifAction(n) + '">' +
        '<span class="menu-icon">' + notifIcon(n.type) + '</span>' +
        '<span class="menu-label" style="display:flex;flex-direction:column;gap:2px">' +
          '<span style="font-weight:600;font-size:14px">' + (n.title || 'Notification') + '</span>' +
          '<span style="font-size:12px;color:var(--bark-light);line-height:1.4">' + (n.message || '') + '</span>' +
        '</span>' +
        '<span class="menu-arrow">›</span>' +
      '</div>';
    }).join('');
  }
  show('notifications');
  currentScreen = 'notifications';
}

async function handleOwnerNotifClick(id) {
  try { await api.markNotificationRead(id); } catch { /* silent */ }
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
          profileImage: match.profileImage || '', // real picture (data URI)
          availability: (match.availability && typeof match.availability === 'object') ? match.availability : {}
        };
      }
    } catch { /* silent — fall through to hardcoded */ }
  }
  if (!resolved) {
    const legacy = minderData[minderId] || { name: 'Your Minder', avatar: '🧑‍🦱' };
    resolved = { ...legacy, id: minderId, profileImage: '' };
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

const BOOKING_TIME_SLOTS = ['08:00','09:00','10:00','11:00','12:00','13:00','14:00','15:00','16:00','17:00','18:00','19:00'];

// Mirror of backend/lib/availability.js — kept tiny so client and server
// agree on which HH:MM falls in which slot bucket and which weekday a date
// belongs to. If you change one side, change both.
const AVAIL_SLOT_RANGES = {
  morning:   { start: 8,  end: 12 },
  afternoon: { start: 12, end: 17 },
  evening:   { start: 17, end: 20 }
};
const AVAIL_DAY_KEYS = ['sun','mon','tue','wed','thu','fri','sat'];
const AVAIL_DAY_LABELS = { mon:'Monday', tue:'Tuesday', wed:'Wednesday', thu:'Thursday', fri:'Friday', sat:'Saturday', sun:'Sunday' };

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

// Chat state — all chat data comes from the backend. chatListCache holds
// the most recent /api/chats response so the sidebar can re-render without
// an extra round-trip when a new message is sent.
let chatListCache = [];
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
    activeChat = null;
    loadChatList();
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
    document.getElementById('bookings-gps-live').style.display = 'block';
    document.getElementById('bookings-past').style.display = 'none';
    document.getElementById('bookings-gps').style.display = 'none';
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
    isAdmin = user.role === 'admin';
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
    if (user.role !== 'admin') { showToast('❌ This account is not an admin'); return; }
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
  const firstName = document.getElementById('reg-first-name').value.trim();
  const lastName  = document.getElementById('reg-last-name').value.trim();
  const email     = document.getElementById('reg-email').value.trim();
  const pwd       = document.getElementById('reg-password').value;
  const confirm   = document.getElementById('reg-confirm-password').value;

  if (!firstName || !lastName || !email) { showToast('❌ Please fill in all fields'); return; }
  if (pwd !== confirm) {
    showToast('❌ Passwords do not match');
    document.getElementById('reg-confirm-password').style.borderColor = 'var(--terra)';
    return;
  }
  document.getElementById('reg-confirm-password').style.borderColor = 'var(--sand)';
  if (selectedRole === 'owner' && regPendingPets.length === 0) {
    showToast('❌ Please add at least one pet before creating your account');
    return;
  }
  if (selectedRole === 'minder') {
    const certBox = document.getElementById('reg-minder-extras-box');
    if (regPendingCerts.length === 0) {
      showToast('❌ Please upload at least one certification to create a Pet Minder account');
      if (certBox) certBox.style.borderColor = 'var(--terra)';
      return;
    }
    if (certBox) certBox.style.borderColor = 'var(--sand)';
  }

  try {
    const { token, user } = await api.signup({ firstName, lastName, email, password: pwd, role: selectedRole });
    api.setToken(token);
    store.setUser(user);
    hydrateUserProfile(user);

    // Now create any pets that were added during registration
    petData = {};
    for (const pending of regPendingPets) {
      try {
        const pet = await api.createPet({ name: pending.name, type: pending.type, breed: pending.breed, age: pending.age, medical: pending.medical, care: pending.care, emoji: pending.emoji });
        petData[pet.id] = pet;
      } catch { /* pet creation failed — continue with account */ }
    }
    store.setPets(petData);
    regPendingPets = [];
    regPendingCerts = [];
    refreshRegCerts();
    goToHome();
  } catch (err) {
    showToast('❌ ' + err.message);
  }
}

function goToAuth() { window.location.href = 'auth.html'; }

function switchAuthTab(tab) {
  document.querySelectorAll('#screen-auth .auth-tab').forEach(t => t.classList.remove('active'));
  event.target.classList.add('active');
  document.getElementById('form-login').classList.toggle('hidden', tab === 'register');
  document.getElementById('form-register').classList.toggle('hidden', tab === 'login');
}

// user can be both
function selectRole(el, role) {
  document.querySelectorAll('.role-btn').forEach(b => b.classList.remove('selected'));
  el.classList.add('selected');
  selectedRole = role;
  document.getElementById('reg-owner-extras').style.display = role === 'owner' ? 'block' : 'none';
  document.getElementById('reg-minder-extras').style.display = role === 'minder' ? 'block' : 'none';
}

function handleCertUpload() {
  const input = document.getElementById('cert-upload-input');
  if (!input || !input.files) return;
  Array.from(input.files).forEach(file => {
    regPendingCerts.push({
      id: regCertNextId++,
      name: file.name,
      size: file.size,
      type: file.type,
      file: file
    });
  });
  // Reset input so the same filename can be re-added after removal
  input.value = '';
  refreshRegCerts();
  const certBox = document.getElementById('reg-minder-extras-box');
  if (certBox && regPendingCerts.length > 0) certBox.style.borderColor = 'var(--sand)';
}

function removeRegCert(certId) {
  regPendingCerts = regPendingCerts.filter(c => c.id !== certId);
  refreshRegCerts();
}

function refreshRegCerts() {
  const grid = document.getElementById('reg-certs-grid');
  if (!grid) return;
  grid.innerHTML = '';
  regPendingCerts.forEach(c => {
    const card = document.createElement('div');
    card.className = 'reg-pet-card';
    const icon = (c.type && c.type.startsWith('image/')) ? '🖼️' : '📄';
    card.innerHTML =
      '<span>' + icon + '</span>' +
      '<span style="max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + c.name + '</span>' +
      '<span class="reg-cert-remove" title="Remove" style="margin-left:4px;color:#e53935;font-weight:700;cursor:pointer">×</span>';
    card.querySelector('.reg-cert-remove').onclick = (e) => { e.stopPropagation(); removeRegCert(c.id); };
    grid.appendChild(card);
  });
  const label = document.getElementById('cert-file-names');
  if (label) {
    label.textContent = regPendingCerts.length > 0
      ? '✅ ' + regPendingCerts.length + ' file' + (regPendingCerts.length === 1 ? '' : 's') + ' added'
      : '';
  }
}

// ===== NAVIGATION =====
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
  if (!el) return;
  if (userProfile.profileImage) {
    el.innerHTML = '<img src="' + userProfile.profileImage + '" alt="avatar" class="avatar-img avatar-profile">';
  } else {
    el.textContent = '👤';
  }
  // Also update the role line
  const roleEl = document.getElementById('profile-display-role');
  if (roleEl) {
    const label = userProfile.role === 'minder' ? 'Pet Minder' : 'Pet Owner';
    roleEl.textContent = label;
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

async function loadMinders() {
  const list = document.getElementById('minders-list');
  if (!list) return;
  try {
    loadedMinders = await api.getMinders();
    // Attach live review stats (avg rating + count) to each minder so the
    // search page can filter by rating and sort by review count.
    try {
      const stats = await api.getReviewStats();
      loadedMinders.forEach(m => {
        const s = stats[m.id];
        m._avgRating    = s ? s.avg   : 0;
        m._reviewCount  = s ? s.count : 0;
      });
    } catch { loadedMinders.forEach(m => { m._avgRating = 0; m._reviewCount = 0; }); }
    if (loadedMinders.length === 0) {
      list.innerHTML = '<div style="padding:40px;text-align:center;color:var(--bark-light);font-size:14px">No pet minders have signed up yet.</div>';
      return;
    }
    renderMinders(loadedMinders);
  } catch {
    list.innerHTML = '<div style="padding:40px;text-align:center;color:var(--bark-light);font-size:14px">Could not load minders. Try refreshing.</div>';
  }
}

// Minder profiles now live on a dedicated page (pages/minder.html). Anywhere
// in the app that calls openMinderProfile(id) just navigates there with the
// id in the query string — the standalone page reads it and hydrates itself
// from /api/minders, so refreshing keeps you on the right profile.
function openMinderProfile(minderId) {
  if (minderId == null) return;
  window.location.href = 'minder.html?id=' + encodeURIComponent(minderId);
}

// Hydrate the standalone minder profile page from a fetched minder object.
// Shared between openMinderProfile (legacy inline) and the minder.html page.
function renderMinderProfileInto(minder) {
  // Stash the currently-viewed minder as the default report target so the
  // "🚩 Report" button in the hero can pick it up without extra state plumbing.
  const canReport = minder && typeof minder.id === 'number' && userProfile.role === 'owner';
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
    if (minder.certifications) html += '<div class="info-row"><span class="info-label">Certifications</span><span class="info-value" style="white-space:pre-wrap;text-align:right;max-width:60%">' + escapeHTML(minder.certifications) + '</span></div>';
    if (!html && isRealMinder) html = '<p style="font-size:13px;color:var(--bark-light);text-align:center;padding:8px 0">This minder hasn\'t added service details yet.</p>';
    details.innerHTML = html;
  }
  renderMinderAvailability(minder);
}

// Tracks which minder is currently being viewed on minder.html so submitReview
// knows where to attach the review the user just wrote.
let currentMinderId = null;

// Bootstraps the standalone minder.html page from ?id=<n> in the URL.
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
    // Fall back to legacy hardcoded demo data (sarah/james/emma/priya)
    if (!minder && minderData[raw]) minder = minderData[raw];
  } catch {
    if (minderData[raw]) minder = minderData[raw];
  }
  if (!minder) {
    document.getElementById('mp-name').textContent = 'Minder not found';
    return;
  }
  currentMinderId = minder.id;
  renderMinderProfileInto(minder);
  // Wire the Book Now button now that we know the id
  const bookBtn = document.getElementById('mp-book-btn');
  if (bookBtn && typeof minder.id === 'number') {
    bookBtn.onclick = function () { window.location.href = 'active-booking.html?minder=' + minder.id; };
  }
  // Wire the Message button
  const msgBtn = document.getElementById('mp-msg-btn');
  if (msgBtn && typeof minder.id === 'number') {
    msgBtn.onclick = function () { messageMinder(minder.id); };
  }
  await loadMinderReviews(minder.id);
}

async function loadMinderReviews(minderId) {
  const list = document.getElementById('minder-reviews-list');
  if (!list) return;
  if (typeof minderId !== 'number') {
    list.innerHTML = '<div style="background:white;border-radius:var(--radius);padding:18px;box-shadow:0 2px 12px var(--shadow);text-align:center;color:var(--bark-light);font-size:13px">Reviews are only available for verified minders.</div>';
    updateMinderStarsSummary([]);
    return;
  }
  try {
    const reviews = await api.getMinderReviews(minderId);
    renderMinderReviews(reviews);
    updateMinderStarsSummary(reviews);
  } catch {
    list.innerHTML = '<div style="background:white;border-radius:var(--radius);padding:18px;box-shadow:0 2px 12px var(--shadow);text-align:center;color:var(--bark-light);font-size:13px">Could not load reviews.</div>';
  }
}

function renderMinderReviews(reviews) {
  const list = document.getElementById('minder-reviews-list');
  if (!list) return;
  if (!reviews.length) {
    list.innerHTML = '<div style="background:white;border-radius:var(--radius);padding:18px;box-shadow:0 2px 12px var(--shadow);text-align:center;color:var(--bark-light);font-size:13px">No reviews yet. Be the first to leave one!</div>';
    return;
  }
  list.innerHTML = reviews.map(r => {
    const stars = '★'.repeat(r.rating) + '☆'.repeat(5 - r.rating);
    const when  = formatChatTime(r.createdAt);
    return '<div style="background:white;border-radius:var(--radius);padding:18px;box-shadow:0 2px 12px var(--shadow)">'
      + '<div style="display:flex;justify-content:space-between;margin-bottom:8px">'
      + '<strong style="font-size:14px">' + escapeHTML(r.authorName || 'User') + '</strong>'
      + '<span style="color:#f5a623">' + stars + '</span></div>'
      + '<p style="font-size:13px;color:var(--bark-light);line-height:1.6">"' + escapeHTML(r.text) + '"</p>'
      + '<p style="font-size:11px;color:var(--bark-light);margin-top:8px">' + when + '</p></div>';
  }).join('');
}

function updateMinderStarsSummary(reviews) {
  const starsEl = document.getElementById('mp-stars');
  if (!starsEl) return;
  if (!reviews || !reviews.length) {
    starsEl.innerHTML = '☆☆☆☆☆ <span style="font-size:13px;opacity:0.8">(no reviews yet)</span>';
    return;
  }
  const avg = reviews.reduce((s, r) => s + r.rating, 0) / reviews.length;
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

function openBooking() { previousScreen = currentScreen; show('booking'); currentScreen = 'booking'; }

function goBack() {
  if (previousScreen) { show(previousScreen); currentScreen = previousScreen; setNavActive(previousScreen); previousScreen = null; }
  else switchTab('home');
}

// ===== MESSAGES =====
// Format an ISO timestamp into a short sidebar label: "HH:MM" today,
// "Yesterday", day name within the last week, otherwise DD/MM.
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
      const b = document.createElement('div');
      b.className = 'msg-bubble ' + (m.fromUserId === myId ? 'sent' : 'received');
      b.innerHTML = escapeHTML(m.text) + '<div class="msg-time">' + formatMsgTime(m.createdAt) + '</div>';
      msgs.appendChild(b);
    });
    msgs.scrollTop = msgs.scrollHeight;
  } catch {
    msgs.innerHTML = '<div style="color:var(--bark-light);font-size:13px;text-align:center">Could not load messages.</div>';
  }
}

function escapeHTML(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function closeMobileChat() { document.getElementById('messages-container').classList.remove('chat-open'); }

async function sendMessage() {
  const input = document.getElementById('chat-input-field');
  const text = input.value.trim();
  if (!text || !activeChat) return;
  input.value = '';
  const msgs = document.getElementById('chat-active-messages');
  const b = document.createElement('div');
  b.className = 'msg-bubble sent';
  b.innerHTML = escapeHTML(text) + '<div class="msg-time">…</div>';
  msgs.appendChild(b);
  msgs.scrollTop = msgs.scrollHeight;
  try {
    const saved = await api.sendChatMessage(activeChat, text);
    b.innerHTML = escapeHTML(saved.text) + '<div class="msg-time">' + formatMsgTime(saved.createdAt) + '</div>';
    // Refresh list so newest-message-first ordering updates (moves active chat to top)
    await loadChatList();
  } catch (err) {
    b.remove();
    showToast('❌ ' + (err.message || 'Failed to send'));
  }
}

const _chatInputField = document.getElementById('chat-input-field');
if (_chatInputField) _chatInputField.addEventListener('keydown', e => { if (e.key === 'Enter') sendMessage(); });

// ===== PROFILE TABS =====
function switchProfileTab(btn, tabId) {
  document.querySelectorAll('.profile-tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  document.querySelectorAll('[id^="tab-"]').forEach(t => t.classList.add('hidden'));
  document.getElementById(tabId).classList.remove('hidden');
}

// ===== BOOKINGS TABS =====
function switchBookingTab(btn, tab) {
  document.querySelectorAll('#screen-bookings .auth-tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('bookings-upcoming').style.display = tab === 'upcoming' ? 'block' : 'none';
  document.getElementById('bookings-gps-live').style.display = tab === 'upcoming' ? 'block' : 'none';
  document.getElementById('bookings-past').style.display = tab === 'past' ? 'block' : 'none';
  document.getElementById('bookings-gps').style.display = tab === 'past' ? 'block' : 'none';
  const reqSection = document.getElementById('bookings-requests');
  if (reqSection) reqSection.style.display = tab === 'requests' ? 'block' : 'none';
  if (tab === 'requests') loadBookingRequests();
}

// ===== BOOKING FLOW =====
function selectService(el) { el.closest('.service-list').querySelectorAll('.service-option').forEach(o => o.classList.remove('selected')); el.classList.add('selected'); updateBookingSummary(); }
async function selectDate(el) { document.querySelectorAll('.date-chip').forEach(d => d.classList.remove('selected')); el.classList.add('selected'); await refreshBookingTimeAvailability(); updateBookingSummary(); }
function selectTime(el) { if (el.classList.contains('unavailable')) return; document.querySelectorAll('.time-chip').forEach(t => t.classList.remove('selected')); el.classList.add('selected'); updateBookingSummary(); }
function toggleChip(el) { el.classList.toggle('active'); }
function toggleFilterModal() { document.getElementById('filter-modal').classList.toggle('open'); }

// ===== SEARCH & FILTER SYSTEM =====
// Saved filter state — only updated when user clicks Save or Clear All.
let savedFilters = { petTypes: [], serviceTypes: [], priceMin: null, priceMax: null, minRating: null };

// Helper: read the text label from a filter-opt, strip its emoji prefix, return lowercase.
function filterOptLabel(el) { return el.textContent.replace(/^[^\w]*/u, '').trim().toLowerCase(); }

// Rating filter is single-select: clicking one deselects the others.
function selectRatingFilter(el) {
  const wasActive = el.classList.contains('active');
  document.querySelectorAll('#filter-rating .filter-opt').forEach(o => o.classList.remove('active'));
  if (!wasActive) el.classList.add('active');
}

// Location search bar — triggered by the Go button or Enter key
function searchByLocation() {
  runSearch();
}

// Central search: combines the location bar + saved modal filters and re-renders.
function runSearch() {
  const locInput = document.getElementById('search-location-input');
  const query = locInput ? locInput.value.trim().toLowerCase() : '';

  const filtered = loadedMinders.filter(m => {
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

    // 5. Rating filter — only show minders whose avg rating >= selected minimum.
    //    Minders with zero reviews are excluded when a rating filter is active.
    if (savedFilters.minRating !== null) {
      if (!m._reviewCount || m._avgRating < savedFilters.minRating) return false;
    }

    return true;
  });

  // Sort: minders with the same rounded avg rating are ordered by review
  // count (highest first) so the most-reviewed minder surfaces first.
  filtered.sort((a, b) => {
    const ra = a._avgRating || 0, rb = b._avgRating || 0;
    if (rb !== ra) return rb - ra;
    return (b._reviewCount || 0) - (a._reviewCount || 0);
  });

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
  savedFilters = { petTypes: [], serviceTypes: [], priceMin: null, priceMax: null, minRating: null };
  runSearch();
  toggleFilterModal();
  showToast('✅ Filters cleared');
}

// Save — read modal UI into savedFilters, then re-run search
function applyFilters() {
  const petTypeEls = document.querySelectorAll('#filter-pet-type .filter-opt.active');
  savedFilters.petTypes = Array.from(petTypeEls).map(filterOptLabel);

  const serviceEls = document.querySelectorAll('#filter-service-type .filter-opt.active');
  savedFilters.serviceTypes = Array.from(serviceEls).map(filterOptLabel);

  const minEl = document.getElementById('filter-price-min');
  const maxEl = document.getElementById('filter-price-max');
  savedFilters.priceMin = minEl && minEl.value !== '' ? Number(minEl.value) : null;
  savedFilters.priceMax = maxEl && maxEl.value !== '' ? Number(maxEl.value) : null;

  const activeRating = document.querySelector('#filter-rating .filter-opt.active');
  savedFilters.minRating = activeRating ? Number(activeRating.dataset.rating) : null;

  const filtered = runSearch();
  toggleFilterModal();
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
    const dayCount = (m.availability && typeof m.availability === 'object') ? Object.keys(m.availability).length : 0;
    const availLine = dayCount ? '🗓 Available ' + dayCount + ' day' + (dayCount === 1 ? '' : 's') + '/week' : '';
    const avgR = m._avgRating  || 0;
    const cntR = m._reviewCount || 0;
    const starsStr = cntR ? '★'.repeat(Math.round(avgR)) + '☆'.repeat(5 - Math.round(avgR)) + ' ' + avgR.toFixed(1) + ' (' + cntR + ')' : '';

    const card = document.createElement('div');
    card.className = 'minder-list-card';
    card.style.cursor = 'pointer';
    card.onclick = function() { openMinderProfile(m.id); };
    card.innerHTML =
      '<div class="minder-list-avatar">' + avatar + '</div>' +
      '<div class="minder-list-info">' +
        '<div class="minder-list-name">' + m.name + '</div>' +
        (starsStr ? '<div class="minder-list-rating" style="font-size:13px;color:#e6a817;margin-top:2px">' + starsStr + '</div>' : '') +
        (loc ? '<div class="minder-list-loc">' + loc + '</div>' : '') +
        (tags.length ? '<div class="minder-list-tags">' + tags.join('') + '</div>' : '') +
        (availLine ? '<div class="minder-list-loc" style="margin-top:2px">' + availLine + '</div>' : '') +
        (price ? '<div class="minder-list-rate">' + price + '</div>' : '') +
        '<div class="minder-btns">' +
          '<button class="btn-msg-minder" onclick="event.stopPropagation();showToast(\'Chat coming soon!\')">💬 Message</button>' +
          '<button class="btn-book-sm" onclick="event.stopPropagation();window.location.href=\'active-booking.html?minder=' + m.id + '\'">Book Now</button>' +
        '</div>' +
      '</div>';
    list.appendChild(card);
  });
}

// ===== PET MANAGEMENT =====
function populatePetAgeOptions() {
  const ageSelects = document.querySelectorAll('#pet-age-input');
  if (!ageSelects.length) return;

  const fragment = document.createDocumentFragment();
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.disabled = true;
  placeholder.selected = true;
  placeholder.textContent = 'Select age';
  fragment.appendChild(placeholder);

  for (let i = 1; i <= 99; i++) {
    const option = document.createElement('option');
    option.value = i;
    option.textContent = i;
    fragment.appendChild(option);
  }

  ageSelects.forEach(select => {
    select.innerHTML = '';
    select.appendChild(fragment.cloneNode(true));
  });
}

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
    const pet = petData[petId] || regPendingPets.find(p => p.id === petId);
    if (!pet) { showToast('Pet not found'); return; }
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
  if (!age) { showToast('❌ Please select your pet age'); return; }
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

// Show pets on registration page — uses regPendingPets (local) before signup,
// and petData (server-backed) after.
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

  if (selectedPets.length === 0) { showToast('❌ Please add a pet before booking'); return; }

  // Pre-submit availability guard. The backend re-validates this on POST
  // /api/bookings, but checking here gives instant feedback and prevents a
  // round-trip when the user has somehow landed on an unavailable slot.
  const availCheck = checkMinderAvailability(m, bookingDate, time);
  if (!availCheck.ok) {
    showToast('❌ ' + availCheck.reason);
    return;
  }

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
  if (typeof currentMinderId !== 'number') {
    showToast('❌ Reviews are only available for verified minders');
    return;
  }
  try {
    await api.createReview({ minderId: currentMinderId, rating: reviewStars, text });
    document.getElementById('review-text-input').value = '';
    setReviewStars(0);
    showToast('✅ Review submitted!');
    // Re-fetch so the new review appears immediately and the star summary updates
    await loadMinderReviews(currentMinderId);
  } catch (err) {
    showToast('❌ ' + (err.message || 'Failed to submit review'));
  }
}

// ===== BECOME MINDER =====
function openBecomeMinder(){
  //ask for any qualifications 
    // if yes ask for pictures (something like auth.html lines 62-69)
    // if no dont ask for pictures (can still provide basic services like feeding or walking)
}

// ===== REVIEWS (from profile section) =====
function openProfileReviews() {
  previousScreen = currentScreen;
  const list = document.getElementById('profile-reviews-minder-list');
  list.innerHTML = '';
  bookedMinders.forEach(m => {
    const card = document.createElement('div'); card.className = 'review-minder-card';
    card.onclick = () => openWriteReview(m.id);
    card.innerHTML = '<div class="review-minder-avatar">' + m.avatar + '</div><div class="review-minder-info"><div class="review-minder-name">' + m.name + '</div><div class="review-minder-booking">' + m.lastBooking + '</div></div><span style="color:var(--terra);font-weight:600;font-size:13px">Write Review ›</span>';
    list.appendChild(card);
  });
  show('profile-reviews'); currentScreen = 'profile-reviews';
}

function openWriteReview(minderId) {
  previousScreen = 'profile-reviews';
  currentReviewMinder = minderId;
  const m = minderData[minderId];
  document.getElementById('write-review-title').textContent = 'Review ' + m.name;
  document.getElementById('profile-review-text').value = '';
  profileReviewStars = 0;
  document.querySelectorAll('#profile-review-stars .star-btn').forEach(s => s.classList.remove('active'));
  show('write-review'); currentScreen = 'write-review';
}

function setProfileReviewStars(n) {
  profileReviewStars = n;
  document.querySelectorAll('#profile-review-stars .star-btn').forEach((s, i) => s.classList.toggle('active', i < n));
}

function submitProfileReview() {
  const text = document.getElementById('profile-review-text').value.trim();
  if (!text) { showToast('❌ Please write a review'); return; }
  if (profileReviewStars === 0) { showToast('❌ Please select a star rating'); return; }
  const starStr = '★'.repeat(profileReviewStars) + '☆'.repeat(5 - profileReviewStars);
  const sub = document.getElementById('profile-review-submitted');
  const card = document.createElement('div');
  card.style.cssText = 'background:white;border-radius:var(--radius);padding:18px;box-shadow:0 2px 12px var(--shadow);margin-bottom:12px';
  card.innerHTML = '<div style="display:flex;justify-content:space-between;margin-bottom:8px"><strong style="font-size:14px">Your Review</strong><span style="color:#f5a623">' + starStr + '</span></div><p style="font-size:13px;color:var(--bark-light);line-height:1.6">"' + text + '"</p><p style="font-size:11px;color:var(--bark-light);margin-top:8px">Just now</p>';
  sub.appendChild(card);
  document.getElementById('profile-review-text').value = '';
  setProfileReviewStars(0);
  showToast('✅ Review submitted!');
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

// ===== IN-CONTEXT REPORT MODAL =====
// Used from the minder profile hero (owner → minder) and from the minder's
// booking requests list (minder → owner). The modal reads `currentReportTarget`
// and submits to POST /api/admin/disputes with structured context so the
// admin dashboard sees who reported whom, from where.
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
// Array variants used for availability (days/slots are stored as arrays,
// not csv, because they're validated against a strict whitelist server-side).
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
function clampPrice(input) {
  if (!input) return 0;
  let v = parseInt(input.value, 10);
  if (isNaN(v) || v < 0) v = 0;
  if (v > 50) v = 50;
  return v;
}

function openEditProfileModal() {
  document.getElementById('edit-first-name').value = userProfile.firstName;
  document.getElementById('edit-last-name').value = userProfile.lastName;
  document.getElementById('edit-email').value = userProfile.email;
  document.getElementById('edit-phone').value = userProfile.phone;
  document.getElementById('edit-location').value = userProfile.location;
  document.getElementById('edit-bio').value = userProfile.bio;
  // Show minder fields only for minder accounts
  const minderFields = document.getElementById('minder-fields');
  if (minderFields) {
    minderFields.style.display = userProfile.role === 'minder' ? 'block' : 'none';
    if (userProfile.role === 'minder') {
      document.getElementById('edit-service-area').value = userProfile.serviceArea || '';
      setSelectedChips('edit-pet-type-chips', userProfile.petsCaredFor || '');
      setSelectedChips('edit-service-type-chips', userProfile.services || '');
      document.getElementById('edit-price-min').value = userProfile.priceMin != null ? userProfile.priceMin : 0;
      document.getElementById('edit-price-max').value = userProfile.priceMax != null ? userProfile.priceMax : 50;
      document.getElementById('edit-experience').value = userProfile.experience || '';
      loadAvailabilityGrid(userProfile.availability || {});
      const certEl = document.getElementById('edit-certifications');
      if (certEl) certEl.value = userProfile.certifications || '';
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
    // Include minder-specific fields if user is a minder
    if (userProfile.role === 'minder') {
      updates.serviceArea  = (document.getElementById('edit-service-area') || {}).value || '';
      updates.petsCaredFor = getSelectedChips('edit-pet-type-chips');
      updates.services     = getSelectedChips('edit-service-type-chips');
      updates.priceMin     = clampPrice(document.getElementById('edit-price-min'));
      updates.priceMax     = clampPrice(document.getElementById('edit-price-max'));
      updates.experience   = (document.getElementById('edit-experience') || {}).value || '';
      updates.availability = readAvailabilityGrid();
      updates.certifications = ((document.getElementById('edit-certifications') || {}).value || '').trim();
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
async function logout() {
  isAdmin = false;
  // Tell the backend to flip the online flag off before we drop the token,
  // so any active chat counterpart sees us as offline right away.
  try { await api.logout(); } catch { /* silent — still clear local session */ }
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
      const statusBadge = u.status === 'Active' ? '' : ' <span style="color:#e53935;font-size:11px">(' + u.status + ')</span>';
      card.innerHTML = '<div class="admin-user-avatar">' + (u.avatar || '👤') + '</div><div class="admin-user-info"><div class="admin-user-name">' + u.name + statusBadge + '</div><div class="admin-user-role">' + u.role + ' · ' + u.email + '</div></div><div class="admin-user-actions"><button class="admin-btn edit" onclick="openAdminEditUser(' + u.id + ')">✏️ Edit</button><button class="admin-btn suspend" onclick="adminSuspendUser(' + u.id + ')">⏸ Suspend</button><button class="admin-btn remove" onclick="adminRemoveUser(' + u.id + ')">🗑 Remove</button></div>';
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
      // Translate the internal context + role codes into a human-readable
      // badge so the admin can see where each report originated.
      const contextLabel = d.context === 'minder-profile' ? '🐾 From minder profile'
                         : d.context === 'booking'        ? ('📅 From booking #' + (d.bookingId || '?'))
                         : d.context === 'help-centre'    ? '❓ From help centre'
                         : '';
      const reporterRoleLabel = d.reporterRole === 'minder' ? 'Pet Minder'
                              : d.reporterRole === 'owner'  ? 'Pet Owner'
                              : d.reporterRole === 'admin'  ? 'Admin' : '';
      const targetRoleLabel   = d.targetRole === 'minder' ? 'Pet Minder'
                              : d.targetRole === 'owner'  ? 'Pet Owner' : '';
      const contextRow = contextLabel
        ? '<p style="font-size:11px;color:var(--terra);font-weight:600;margin-bottom:6px">' + contextLabel + '</p>'
        : '';
      card.innerHTML =
        '<div class="dispute-header"><span class="dispute-badge open">' + d.status + '</span><span class="dispute-date">' + d.date + '</span></div>' +
        '<div class="dispute-body">' +
          contextRow +
          '<p><strong>Reported by:</strong> ' + d.from + (reporterRoleLabel ? ' <span style="color:var(--bark-light);font-size:12px">(' + reporterRoleLabel + ')</span>' : '') + '</p>' +
          '<p><strong>Against:</strong> ' + d.against + (targetRoleLabel ? ' <span style="color:var(--bark-light);font-size:12px">(' + targetRoleLabel + ')</span>' : '') + '</p>' +
          '<p><strong>Reason:</strong> ' + d.reason + '</p>' +
        '</div>' +
        '<div class="dispute-actions">' +
          '<button class="admin-btn edit" onclick="resolveDispute(' + d.id + ')">✅ Resolve</button>' +
          '<button class="admin-btn remove" onclick="dismissDispute(' + d.id + ')">Dismiss</button>' +
        '</div>';
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
  showConfirmModal('⏸', 'Suspend User?', 'This user will be unable to log in.', async function() {
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

// ===== TOAST =====
function showToast(msg) {
  const t = document.getElementById('toast'); t.textContent = msg; t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2500);
}

// Initial render
refreshPetsUI();
populatePetAgeOptions();
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
