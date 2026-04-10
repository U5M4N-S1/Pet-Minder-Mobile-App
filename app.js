let currentScreen = 'landing';
let previousScreen = null;
const appScreens = ['home', 'search', 'bookings', 'messages', 'profile'];
let isAdmin = false;
let selectedRole = 'owner';
let reviewStars = 0;
let profileReviewStars = 0;
let currentEditPetId = null;
let currentReviewMinder = null;
let reportSelectedUser = null;

// User profile — populated from the session cache or API on page load
let userProfile = { firstName: '', lastName: '', email: '', phone: '', location: '', bio: '' };

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

  login(email, password)   { return this._req('POST',   '/auth/login',  { email, password }); },
  signup(data)              { return this._req('POST',   '/auth/signup', data); },
  getMe()                   { return this._req('GET',    '/auth/me'); },
  updateMe(data)            { return this._req('PATCH',  '/auth/me', data); },
  getBookings()             { return this._req('GET',    '/bookings'); },
  createBooking(data)       { return this._req('POST',   '/bookings', data); },
  getPets()                 { return this._req('GET',    '/pets'); },
  createPet(data)           { return this._req('POST',   '/pets', data); },
  updatePet(id, data)       { return this._req('PATCH',  '/pets/' + id, data); },
  deletePet(id)             { return this._req('DELETE', '/pets/' + id); },
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
(function initUserFromCache() {
  const u = store.getUser();
  if (!u) return;
  userProfile.firstName = u.firstName || '';
  userProfile.lastName  = u.lastName  || '';
  userProfile.email     = u.email     || '';
  userProfile.phone     = u.phone     || '';
  userProfile.location  = u.location  || '';
  userProfile.bio       = u.bio       || '';
}());

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
const statusLabels = { confirmed: 'Confirmed', pending: 'Pending', completed: 'Done' };

function renderBookingCards(containerId, bookings) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = bookings.map(b => `
    <div class="booking-card" onclick="window.location.href='active-booking.html?minder=${b.minder}'" style="cursor:pointer">
      <div class="booking-date-block"><div class="booking-date-day">${b.day}</div><div class="booking-date-month">${b.month}</div></div>
      <div class="booking-date-sep"></div>
      <div class="booking-avatar">${b.avatar}</div>
      <div class="booking-info">
        <div class="booking-minder">${b.minderName}</div>
        <div class="booking-detail">${b.petEmoji} ${b.petDetail}</div>
        ${b.price ? `<div class="booking-detail" style="margin-top:4px;color:var(--terra)">${b.price}</div>` : ''}
      </div>
      <span class="booking-status status-${b.status}">${statusLabels[b.status]}</span>
    </div>`).join('');
}

// Active booking page
function initActiveBookingPage() {
  const params = new URLSearchParams(window.location.search);
  const minderId = params.get('minder') || 'sarah';
  const m = minderData[minderId] || { name: 'Your Minder', avatar: '🧑‍🦱' };
  window._activeMinder = { ...m, id: minderId };
  const header = document.getElementById('booking-minder-name');
  if (header) header.textContent = 'Book ' + m.name;
  const summaryMinder = document.getElementById('summary-minder');
  if (summaryMinder) summaryMinder.textContent = m.name;
  generateDateChips();
  renderBookingPetPicker();
  updateBookingSummary();
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
const chatData = {
  sarah: { name: 'Sarah K.', avatar: '🧑‍🦱', online: true, messages: [
    { from: 'them', text: "Hi Usman! Excited for Monday's walk with Buddy 🐕", time: '10:28' },
    { from: 'me', text: "Hi Sarah! He's been looking forward to it all week 😄", time: '10:29' },
    { from: 'them', text: 'Haha brilliant! Should I bring his usual treats?', time: '10:31' },
    { from: 'me', text: 'Yes please! He loves the chicken ones 🍗', time: '10:31' },
    { from: 'them', text: "Sounds good! I'll bring a treat for Buddy 🐕", time: '10:32' }
  ]},
  emma: { name: 'Emma T.', avatar: '🧔', online: false, messages: [
    { from: 'them', text: "Hi! I've confirmed your booking for Wednesday", time: 'Yesterday' },
    { from: 'me', text: 'Perfect, thank you! Luna will be ready', time: 'Yesterday' },
    { from: 'them', text: 'Your booking is confirmed for Wednesday!', time: 'Yesterday' }
  ]},
  james: { name: 'James M.', avatar: '👩‍🦰', online: false, messages: [
    { from: 'them', text: 'Just finished the visit with Luna!', time: 'Mon' },
    { from: 'them', text: 'Luna was an absolute angel today 🐈', time: 'Mon' },
    { from: 'me', text: 'Thank you so much James! 😊', time: 'Mon' }
  ]}
};

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
  document.getElementById('screen-' + id).classList.add('active');
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
    upTab.classList.add('active');
    pastTab.classList.remove('active');
    document.getElementById('bookings-upcoming').style.display = 'block';
    document.getElementById('bookings-gps-live').style.display = 'block';
    document.getElementById('bookings-past').style.display = 'none';
    document.getElementById('bookings-gps').style.display = 'none';
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
    Object.assign(userProfile, {
      firstName: user.firstName || '',
      lastName:  user.lastName  || '',
      email:     user.email     || '',
      phone:     user.phone     || '',
      location:  user.location  || '',
      bio:       user.bio       || ''
    });
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

  try {
    const { token, user } = await api.signup({ firstName, lastName, email, password: pwd, role: selectedRole });
    api.setToken(token);
    store.setUser(user);
    Object.assign(userProfile, {
      firstName: user.firstName || '',
      lastName:  user.lastName  || '',
      email:     user.email     || '',
      phone:     '',
      location:  user.location  || '',
      bio:       ''
    });
    // Brand-new accounts always start with an empty pet list.
    petData = {};
    store.setPets(petData);
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

function selectRole(el, role) {
  document.querySelectorAll('.role-btn').forEach(b => b.classList.remove('selected'));
  el.classList.add('selected');
  selectedRole = role;
  document.getElementById('reg-owner-extras').style.display = role === 'owner' ? 'block' : 'none';
  document.getElementById('reg-minder-extras').style.display = role === 'minder' ? 'block' : 'none';
}

function handleCertUpload() {
  const input = document.getElementById('cert-upload-input');
  document.getElementById('cert-file-names').textContent = '✅ ' + Array.from(input.files).map(f => f.name).join(', ');
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

function openMinderProfile(minderId) {
  previousScreen = currentScreen;
  if (minderId && minderData[minderId]) {
    const m = minderData[minderId];
    document.getElementById('mp-avatar').textContent = m.avatar;
    document.getElementById('mp-name').textContent = m.name;
    document.getElementById('mp-loc').textContent = m.loc;
    document.getElementById('mp-stars').innerHTML = m.stars + ' <span style="font-size:13px;opacity:0.8">(' + m.reviews + ' reviews)</span>';
    document.getElementById('mp-bio').textContent = m.bio;
  }
  // Reset to About tab
  document.querySelectorAll('.profile-tab').forEach(t => t.classList.remove('active'));
  document.querySelector('.profile-tab').classList.add('active');
  document.querySelectorAll('[id^="tab-"]').forEach(t => t.classList.add('hidden'));
  document.getElementById('tab-about').classList.remove('hidden');
  show('minder-profile');
  currentScreen = 'minder-profile';
}

function openBooking() { previousScreen = currentScreen; show('booking'); currentScreen = 'booking'; }

function goBack() {
  if (previousScreen) { show(previousScreen); currentScreen = previousScreen; setNavActive(previousScreen); previousScreen = null; }
  else switchTab('home');
}

// ===== MESSAGES =====
function messageMinder(chatId) {
  switchTab('messages');
  setTimeout(() => {
    const items = document.querySelectorAll('.chat-item');
    const map = { sarah: 0, emma: 1, james: 2 };
    if (map[chatId] !== undefined && items[map[chatId]]) openChatInline(items[map[chatId]], chatId);
  }, 100);
}

function openChatInline(el, chatId) {
  activeChat = chatId;
  const data = chatData[chatId];
  document.querySelectorAll('.chat-item').forEach(c => c.classList.remove('active-chat'));
  el.classList.add('active-chat');
  const u = el.querySelector('.chat-unread'); if (u) u.remove();
  document.getElementById('chat-empty-state').style.display = 'none';
  const area = document.getElementById('chat-active-area'); area.style.display = 'flex';
  document.getElementById('chat-active-avatar').textContent = data.avatar;
  document.getElementById('chat-active-name').textContent = data.name;
  document.getElementById('chat-active-status').innerHTML = data.online ? '● Online' : '● Offline';
  document.getElementById('chat-active-status').style.color = data.online ? '#4caf50' : '#999';
  const msgs = document.getElementById('chat-active-messages'); msgs.innerHTML = '';
  data.messages.forEach(m => { const b = document.createElement('div'); b.className = 'msg-bubble ' + (m.from === 'me' ? 'sent' : 'received'); b.innerHTML = m.text + '<div class="msg-time">' + m.time + '</div>'; msgs.appendChild(b); });
  msgs.scrollTop = msgs.scrollHeight;
  document.getElementById('messages-container').classList.add('chat-open');
}
function closeMobileChat() { document.getElementById('messages-container').classList.remove('chat-open'); }
function sendMessage() {
  const input = document.getElementById('chat-input-field'); const text = input.value.trim();
  if (!text || !activeChat) return;
  const msgs = document.getElementById('chat-active-messages');
  const b = document.createElement('div'); b.className = 'msg-bubble sent'; b.innerHTML = text + '<div class="msg-time">Now</div>';
  msgs.appendChild(b); msgs.scrollTop = msgs.scrollHeight;
  chatData[activeChat].messages.push({ from: 'me', text, time: 'Now' }); input.value = '';
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
}

// ===== BOOKING FLOW =====
function selectService(el) { el.closest('.service-list').querySelectorAll('.service-option').forEach(o => o.classList.remove('selected')); el.classList.add('selected'); updateBookingSummary(); }
function selectDate(el) { document.querySelectorAll('.date-chip').forEach(d => d.classList.remove('selected')); el.classList.add('selected'); updateBookingSummary(); }
function selectTime(el) { if (el.classList.contains('unavailable')) return; document.querySelectorAll('.time-chip').forEach(t => t.classList.remove('selected')); el.classList.add('selected'); updateBookingSummary(); }
function toggleChip(el) { el.classList.toggle('active'); }
function toggleFilterModal() { document.getElementById('filter-modal').classList.toggle('open'); }

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
  const body = { name, type, breed, age, medical, care, emoji: petEmojis[type] || '🐾' };

  if (petId === 'new') {
    try {
      const pet = await api.createPet(body);
      petData[pet.id] = pet;
      store.setPets(petData); // offline cache
      closePetModal();
      showToast('✅ ' + name + ' added successfully!');
      refreshPetsUI();
      refreshRegPets();
    } catch (err) {
      showToast('❌ ' + (err.message || 'Failed to save pet'));
    }
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

function confirmRemovePet() {
  const petId = document.getElementById('pet-edit-id').value;
  const pet = petData[petId]; if (!pet) return;
  showConfirmModal('🗑', 'Remove ' + pet.name + '?', 'Are you sure? This cannot be undone.', async function() {
    const petName = pet.name;
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
}

// Show pets on registration page
function refreshRegPets() {
  const grid = document.getElementById('reg-pets-grid');
  if (!grid) return;
  grid.innerHTML = '';
  Object.keys(petData).forEach(id => {
    const p = petData[id];
    const card = document.createElement('div'); card.className = 'reg-pet-card';
    card.onclick = () => openPetModal(id);
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
  const petNames = selectedPets.map(id => (petData[id] && petData[id].name) || id).join(' & ');
  const totalEl = document.getElementById('summary-total');
  const price   = totalEl ? totalEl.textContent : '£15.00';

  try {
    await api.createBooking({
      minderKey:    m.id,
      minderName:   m.name,
      minderAvatar: m.avatar,
      service:      serviceName,
      bookingDate,
      bookingTime:  time,
      petNames,
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
function submitReview() {
  const text = document.getElementById('review-text-input').value.trim();
  if (!text) { showToast('❌ Please write a review'); return; }
  if (reviewStars === 0) { showToast('❌ Please select a star rating'); return; }
  const container = document.getElementById('user-reviews-container');
  const starStr = '★'.repeat(reviewStars) + '☆'.repeat(5 - reviewStars);
  const review = document.createElement('div');
  review.style.cssText = 'background:white;border-radius:var(--radius);padding:18px;box-shadow:0 2px 12px var(--shadow)';
  review.innerHTML = '<div style="display:flex;justify-content:space-between;margin-bottom:8px"><strong style="font-size:14px">' + userProfile.firstName + ' ' + userProfile.lastName.charAt(0) + '.</strong><span style="color:#f5a623">' + starStr + '</span></div><p style="font-size:13px;color:var(--bark-light);line-height:1.6">"' + text + '"</p><p style="font-size:11px;color:var(--bark-light);margin-top:8px">Just now</p>';
  container.appendChild(review);
  document.getElementById('review-text-input').value = '';
  setReviewStars(0);
  showToast('✅ Review submitted!');
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

// ===== EDIT PROFILE =====
function openEditProfileModal() {
  document.getElementById('edit-first-name').value = userProfile.firstName;
  document.getElementById('edit-last-name').value = userProfile.lastName;
  document.getElementById('edit-email').value = userProfile.email;
  document.getElementById('edit-phone').value = userProfile.phone;
  document.getElementById('edit-location').value = userProfile.location;
  document.getElementById('edit-bio').value = userProfile.bio;
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
    // Optimistic local update so the UI feels instant
    Object.assign(userProfile, updates);
    store.setUser(userProfile);
    closeEditProfileModal();
    refreshPetsUI();

    // Push to the backend so the change survives logout/login
    try {
      const saved = await api.updateMe(updates);
      Object.assign(userProfile, saved);
      store.setUser(userProfile);
      refreshPetsUI();
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
if (document.getElementById('admin-users')) loadAdminData();

// ===== AUTH GUARD =====
// Pages that require a valid session. auth.html and index.html are excluded.
const PROTECTED = ['home.html','search.html','bookings.html','messages.html','profile.html','admin.html','active-booking.html'];

document.addEventListener('DOMContentLoaded', async () => {
  const page = window.location.pathname.split('/').pop() || 'index.html';
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

    userProfile.firstName = user.firstName || '';
    userProfile.lastName  = user.lastName  || '';
    userProfile.email     = user.email     || '';
    userProfile.phone     = user.phone     || '';
    userProfile.location  = user.location  || '';
    userProfile.bio       = user.bio       || '';
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
