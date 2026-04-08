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

// User profile
let userProfile = { firstName: 'Usman', lastName: 'Khan', email: 'usman@email.com', phone: '', location: 'Shoreditch, London', bio: '' };

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

// Booking data (seed / default)
const upcomingBookings = [
  { minder: 'sarah', minderName: 'Sarah K.', avatar: '🧑‍🦱', day: '07', month: 'Apr', petEmoji: '🐕', petDetail: 'Buddy · Dog Walk · 08:00', price: '£15.00', status: 'confirmed' },
  { minder: 'emma',  minderName: 'Emma T.',  avatar: '🧔',    day: '09', month: 'Apr', petEmoji: '🐈', petDetail: 'Luna · Home Visit · 14:00', price: '£12.00', status: 'pending' }
];
const pastBookings = [
  { minder: 'sarah', minderName: 'Sarah K.', avatar: '🧑‍🦱', day: '28', month: 'Mar', petEmoji: '🐕', petDetail: 'Buddy · Dog Walk · 10:00', status: 'completed' },
  { minder: 'james', minderName: 'James M.', avatar: '👩‍🦰', day: '20', month: 'Mar', petEmoji: '🐈', petDetail: 'Luna · Home Visit · 15:00', status: 'completed' }
];
const statusLabels = { confirmed: 'Confirmed', pending: 'Pending', completed: 'Done' };

function getUpcomingBookings() {
  const stored = JSON.parse(localStorage.getItem('pawpal_bookings') || '[]');
  return [...upcomingBookings, ...stored];
}

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
  updateBookingSummary();
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

// Admin users data
const adminUsers = [
  { id: 'usman', name: 'Usman Khan', email: 'usman@email.com', role: 'Pet Owner', status: 'Active', avatar: '👤' },
  { id: 'sarah', name: 'Sarah K.', email: 'sarah@email.com', role: 'Pet Minder', status: 'Active', avatar: '👩‍🦰' },
  { id: 'james', name: 'James M.', email: 'james@email.com', role: 'Pet Minder', status: 'Active', avatar: '👩‍🦰' },
  { id: 'emma', name: 'Emma T.', email: 'emma@email.com', role: 'Pet Minder', status: 'Active', avatar: '🧔' }
];

// Admin disputes
const adminDisputes = [
  { id: 1, status: 'Open', date: '3 Apr 2026', from: 'Usman Khan (Pet Owner)', against: 'Priya S. (Pet Minder)', reason: 'Minder did not show up for scheduled appointment. No communication was received.' },
  { id: 2, status: 'Open', date: '1 Apr 2026', from: 'Sarah K. (Pet Minder)', against: 'Tom H. (Pet Owner)', reason: 'Abusive language used in messages. Screenshots attached.' }
];

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
let selectedPets = ['buddy'];

// Pet data
const petData = {
  buddy: { name: 'Buddy', type: 'Dog', breed: 'Golden Retriever', age: '3 years', medical: 'Up to date on vaccinations. No known allergies.', care: 'Loves chicken treats. Walks twice daily.', emoji: '🐕' },
  luna: { name: 'Luna', type: 'Cat', breed: 'British Shorthair', age: '2 years', medical: 'Flea treatment monthly.', care: 'Indoor cat. Feeds at 8am and 6pm.', emoji: '🐈' }
};
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

function handleLogin() {
  const email = document.getElementById('login-email').value.trim();
  const pwd = document.getElementById('login-password').value.trim();
  isAdmin = false;
  goToHome();
}

function handleAdminLogin() {
  const user = document.getElementById('admin-username').value.trim();
  const pwd = document.getElementById('admin-password').value.trim();
  if (user === 'pawpaladmin' && pwd === 'Admin2026!') {
    isAdmin = true;
    window.location.href = 'admin.html';
  } else {
    showToast('❌ Invalid admin credentials');
  }
}

function handleRegister() {
  const pwd = document.getElementById('reg-password').value;
  const confirm = document.getElementById('reg-confirm-password').value;
  if (pwd !== confirm) { showToast('❌ Passwords do not match'); document.getElementById('reg-confirm-password').style.borderColor = 'var(--terra)'; return; }
  document.getElementById('reg-confirm-password').style.borderColor = 'var(--sand)';
  userProfile.firstName = document.getElementById('reg-first-name').value.trim() || 'Usman';
  userProfile.lastName = document.getElementById('reg-last-name').value.trim() || 'Khan';
  goToHome();
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

function savePet() {
  const petId = document.getElementById('pet-edit-id').value;
  const name = document.getElementById('pet-name-input').value.trim();
  const type = document.getElementById('pet-type-input').value;
  const breed = document.getElementById('pet-breed-input').value.trim();
  const age = document.getElementById('pet-age-input').value.trim();
  const medical = document.getElementById('pet-medical-input').value.trim();
  const care = document.getElementById('pet-care-input').value.trim();
  if (!name) { showToast('❌ Please enter a pet name'); return; }

  if (petId === 'new') {
    const newId = name.toLowerCase().replace(/\s+/g, '_') + '_' + Date.now();
    petData[newId] = { name, type, breed, age, medical, care, emoji: petEmojis[type] || '🐾' };
    closePetModal();
    showToast('✅ ' + name + ' added successfully!');
    refreshPetsUI();
    refreshRegPets();
  } else {
    showConfirmModal('💾', 'Save Changes?', 'Save changes to ' + name + '?', function() {
      petData[petId].name = name; petData[petId].type = type; petData[petId].breed = breed;
      petData[petId].age = age; petData[petId].medical = medical; petData[petId].care = care;
      petData[petId].emoji = petEmojis[type] || '🐾';
      closePetModal();
      showToast('✅ ' + name + ' updated!');
      refreshPetsUI();
      refreshRegPets();
    });
  }
}

function confirmRemovePet() {
  const petId = document.getElementById('pet-edit-id').value;
  const pet = petData[petId]; if (!pet) return;
  showConfirmModal('🗑', 'Remove ' + pet.name + '?', 'Are you sure? This cannot be undone.', function() {
    const petName = pet.name;
    delete petData[petId];
    closePetModal();
    showToast('🗑 ' + petName + ' removed');
    refreshPetsUI();
    refreshRegPets();
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
  // Names
  const profileName = document.getElementById('profile-display-name');
  if (profileName) profileName.textContent = userProfile.firstName;
  const homeName = document.getElementById('home-user-name');
  if (homeName) homeName.textContent = userProfile.firstName;
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
  const petNames = { buddy: '🐕 Buddy', luna: '🐈 Luna' };
  const petsEl = document.getElementById('summary-pets');
  if (petsEl) petsEl.textContent = selectedPets.map(p => petNames[p] || p).join(' & ');

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
function confirmBooking() {
  const m = window._activeMinder || { name: 'your minder', avatar: '🧑‍🦱', id: 'sarah' };
  const serviceEl = document.querySelector('.service-option.selected .service-name');
  const serviceName = serviceEl ? serviceEl.textContent : 'Dog Walk';
  const dateEl = document.querySelector('.date-chip.selected');
  const timeEl = document.querySelector('.time-chip.selected');
  const day = dateEl ? (dateEl.dataset.day || dateEl.querySelector('.day-num').textContent) : '??';
  const month = dateEl ? (dateEl.dataset.month || 'Apr') : 'Apr';
  const time = timeEl ? timeEl.textContent : '08:00';
  const petEmojisMap = { buddy: '🐕', luna: '🐈' };
  const petNamesMap = { buddy: 'Buddy', luna: 'Luna' };
  const firstPet = selectedPets[0] || 'buddy';
  const totalEl = document.getElementById('summary-total');
  const price = totalEl ? totalEl.textContent : '£15.00';
  const newBooking = {
    minder: m.id || 'sarah',
    minderName: m.name,
    avatar: m.avatar,
    day: String(day).padStart(2, '0'),
    month,
    petEmoji: petEmojisMap[firstPet] || '🐾',
    petDetail: (petNamesMap[firstPet] || 'Pet') + ' · ' + serviceName + ' · ' + time,
    price,
    status: 'pending'
  };
  const stored = JSON.parse(localStorage.getItem('pawpal_bookings') || '[]');
  stored.push(newBooking);
  localStorage.setItem('pawpal_bookings', JSON.stringify(stored));
  showToast('✅ Booking sent to ' + m.name + '!');
  setTimeout(() => window.location.href = 'bookings.html', 1200);
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
  showConfirmModal('🚨', 'Submit Report?', 'Report ' + reportSelectedUser.name + ' for violating community guidelines?', function() {
    // Add to admin disputes
    adminDisputes.push({ id: Date.now(), status: 'Open', date: new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }), from: userProfile.firstName + ' ' + userProfile.lastName + ' (Pet Owner)', against: reportSelectedUser.name + ' (' + reportSelectedUser.role + ')', reason: reason });
    showToast('✅ Report submitted. Our team will review it.');
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
  showConfirmModal('💾', 'Save Profile Changes?', 'Update your profile information?', function() {
    userProfile.firstName = fn;
    userProfile.lastName = document.getElementById('edit-last-name').value.trim();
    userProfile.email = document.getElementById('edit-email').value.trim();
    userProfile.phone = document.getElementById('edit-phone').value.trim();
    userProfile.location = document.getElementById('edit-location').value.trim();
    userProfile.bio = document.getElementById('edit-bio').value.trim();
    closeEditProfileModal();
    showToast('✅ Profile updated!');
    refreshPetsUI();
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
  window.location.href = '../index.html';
}

// ===== ADMIN =====
function renderAdminPanels() {
  // Users panel
  const usersPanel = document.getElementById('admin-users');
  usersPanel.innerHTML = '<div class="admin-section-title">Registered Users</div>';
  adminUsers.forEach(u => {
    const card = document.createElement('div'); card.className = 'admin-user-card'; card.id = 'admin-card-' + u.id;
    const statusBadge = u.status === 'Active' ? '' : ' <span style="color:#e53935;font-size:11px">(' + u.status + ')</span>';
    card.innerHTML = '<div class="admin-user-avatar">' + u.avatar + '</div><div class="admin-user-info"><div class="admin-user-name">' + u.name + statusBadge + '</div><div class="admin-user-role">' + u.role + ' · ' + u.email + '</div></div><div class="admin-user-actions"><button class="admin-btn edit" onclick="openAdminEditUser(\'' + u.id + '\')">✏️ Edit</button><button class="admin-btn suspend" onclick="adminSuspendUser(\'' + u.id + '\')">⏸ Suspend</button><button class="admin-btn remove" onclick="adminRemoveUser(\'' + u.id + '\')">🗑 Remove</button></div>';
    usersPanel.appendChild(card);
  });
  // Disputes panel
  const disputesPanel = document.getElementById('admin-disputes');
  disputesPanel.innerHTML = '<div class="admin-section-title">Open Disputes</div>';
  adminDisputes.forEach(d => {
    const card = document.createElement('div'); card.className = 'dispute-card';
    card.innerHTML = '<div class="dispute-header"><span class="dispute-badge open">' + d.status + '</span><span class="dispute-date">' + d.date + '</span></div><div class="dispute-body"><p><strong>Reported by:</strong> ' + d.from + '</p><p><strong>Against:</strong> ' + d.against + '</p><p><strong>Reason:</strong> ' + d.reason + '</p></div><div class="dispute-actions"><button class="admin-btn edit" onclick="this.closest(\'.dispute-card\').remove();showToast(\'✅ Dispute resolved\')">✅ Resolve</button><button class="admin-btn suspend" onclick="showToast(\'⏸ User suspended\')">⏸ Suspend User</button><button class="admin-btn remove" onclick="this.closest(\'.dispute-card\').remove();showToast(\'🗑 Dismissed\')">Dismiss</button></div>';
    disputesPanel.appendChild(card);
  });
}

function switchAdminTab(btn, panelId) {
  document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  document.querySelectorAll('.admin-panel').forEach(p => p.style.display = 'none');
  document.getElementById(panelId).style.display = 'block';
}

let adminEditingId = null;
function openAdminEditUser(userId) {
  adminEditingId = userId;
  const user = adminUsers.find(u => u.id === userId); if (!user) return;
  document.getElementById('admin-edit-title').textContent = 'Edit ' + user.name;
  document.getElementById('admin-edit-name').value = user.name;
  document.getElementById('admin-edit-email').value = user.email;
  document.getElementById('admin-edit-role').value = user.role;
  document.getElementById('admin-edit-status').value = user.status;
  document.getElementById('admin-edit-modal').classList.add('open');
}
function closeAdminEditModal() { document.getElementById('admin-edit-modal').classList.remove('open'); }

function saveAdminEdit() {
  if (!adminEditingId) return;
  const user = adminUsers.find(u => u.id === adminEditingId);
  if (user) {
    user.name = document.getElementById('admin-edit-name').value.trim();
    user.email = document.getElementById('admin-edit-email').value.trim();
    user.role = document.getElementById('admin-edit-role').value;
    user.status = document.getElementById('admin-edit-status').value;
  }
  closeAdminEditModal();
  showToast('✅ User profile updated');
  renderAdminPanels();
}

function adminSuspendUser(userId) {
  showConfirmModal('⏸', 'Suspend User?', 'This user will be unable to log in.', function() {
    const user = adminUsers.find(u => u.id === userId);
    if (user) user.status = 'Suspended';
    showToast('⏸ User account suspended');
    renderAdminPanels();
  });
}

function adminRemoveUser(userId) {
  showConfirmModal('🗑', 'Remove User?', 'Permanently remove this account? This cannot be undone.', function() {
    const idx = adminUsers.findIndex(u => u.id === userId);
    if (idx !== -1) adminUsers.splice(idx, 1);
    showToast('🗑 User account removed');
    renderAdminPanels();
  });
}

// ===== TOAST =====
function showToast(msg) {
  const t = document.getElementById('toast'); t.textContent = msg; t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2500);
}

// Initial render
refreshPetsUI();
if (document.getElementById('admin-users')) renderAdminPanels();
