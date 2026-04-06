// Track which screen is showing
let currentScreen = 'landing';
let previousScreen = null;
const appScreens = ['home', 'search', 'bookings', 'messages', 'profile'];
let isAdmin = false;
let selectedRole = 'owner';
let reviewStars = 0;
let currentEditPetId = null;

// User profile data
let userProfile = {
  firstName: 'Usman',
  lastName: 'Khan',
  email: 'usman@email.com',
  phone: '',
  location: 'Shoreditch, London',
  bio: ''
};

// Chat message data for each minder
const chatData = {
  sarah: {
    name: 'Sarah K.', avatar: '🧑‍🦱', online: true,
    messages: [
      { from: 'them', text: 'Hi Usman! Excited for Monday\'s walk with Buddy 🐕', time: '10:28' },
      { from: 'me', text: 'Hi Sarah! He\'s been looking forward to it all week 😄', time: '10:29' },
      { from: 'them', text: 'Haha brilliant! Should I bring his usual treats?', time: '10:31' },
      { from: 'me', text: 'Yes please! He loves the chicken ones 🍗', time: '10:31' },
      { from: 'them', text: 'Sounds good! I\'ll bring a treat for Buddy 🐕', time: '10:32' }
    ]
  },
  emma: {
    name: 'Emma T.', avatar: '🧔', online: false,
    messages: [
      { from: 'them', text: 'Hi! I\'ve confirmed your booking for Wednesday', time: 'Yesterday' },
      { from: 'me', text: 'Perfect, thank you! Luna will be ready', time: 'Yesterday' },
      { from: 'them', text: 'Your booking is confirmed for Wednesday!', time: 'Yesterday' }
    ]
  },
  james: {
    name: 'James M.', avatar: '👩‍🦰', online: false,
    messages: [
      { from: 'them', text: 'Just finished the visit with Luna!', time: 'Mon' },
      { from: 'them', text: 'Luna was an absolute angel today 🐈', time: 'Mon' },
      { from: 'me', text: 'Thank you so much James! 😊', time: 'Mon' }
    ]
  }
};

let activeChat = null;
let selectedPets = ['buddy'];

// Pet details
const petData = {
  buddy: {
    name: 'Buddy', type: 'Dog', breed: 'Golden Retriever', age: '3 years',
    medical: 'Up to date on vaccinations. No known allergies.',
    care: 'Loves chicken treats. Walks twice daily, prefers the park route. Gets anxious around loud noises.',
    emoji: '🐕'
  },
  luna: {
    name: 'Luna', type: 'Cat', breed: 'British Shorthair', age: '2 years',
    medical: 'Flea treatment monthly. Slight sensitivity to fish-based foods.',
    care: 'Indoor cat. Feeds at 8am and 6pm. Likes to be brushed. Shy with strangers at first.',
    emoji: '🐈'
  }
};

const petEmojis = { Dog: '🐕', Cat: '🐈', Rabbit: '🐇', Bird: '🐦', Other: '🐾' };


// Switch to a screen by id
function show(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('screen-' + id).classList.add('active');

  const nav = document.getElementById('app-nav');
  const mh = document.getElementById('mobile-header');
  const isApp = appScreens.includes(id);

  if (nav) nav.classList.toggle('hidden', !isApp);
  if (mh) mh.style.display = isApp ? '' : 'none';

  // Reset messages view
  if (id === 'messages') {
    document.getElementById('messages-container').classList.remove('chat-open');
    document.getElementById('chat-empty-state').style.display = 'flex';
    document.getElementById('chat-active-area').style.display = 'none';
    document.querySelectorAll('.chat-item').forEach(c => c.classList.remove('active-chat'));
    activeChat = null;
  }

  // Fix bookings tab: ensure upcoming is highlighted by default
  if (id === 'bookings') {
    const upTab = document.getElementById('bookings-tab-upcoming');
    const pastTab = document.getElementById('bookings-tab-past');
    if (upTab && !upTab.classList.contains('active') && pastTab && !pastTab.classList.contains('active')) {
      upTab.classList.add('active');
    }
    // If neither is active, force upcoming
    if (upTab && pastTab && !upTab.classList.contains('active') && !pastTab.classList.contains('active')) {
      switchBookingTab(upTab, 'upcoming');
    }
  }
}


// ===== AUTH =====

function handleLogin() {
  const email = document.getElementById('login-email').value.trim();
  const pwd = document.getElementById('login-password').value.trim();

  // Admin login
  if (email === 'admin@pawpal.com' && pwd === 'admin123') {
    isAdmin = true;
    show('admin');
    currentScreen = 'admin';
    const nav = document.getElementById('app-nav');
    if (nav) nav.classList.add('hidden');
    document.getElementById('mobile-header').style.display = 'none';
    return;
  }

  isAdmin = false;
  goToHome();
}

function handleRegister() {
  const pwd = document.getElementById('reg-password').value;
  const confirm = document.getElementById('reg-confirm-password').value;
  if (pwd !== confirm) {
    showToast('❌ Passwords do not match');
    document.getElementById('reg-confirm-password').style.borderColor = 'var(--terra)';
    return;
  }
  document.getElementById('reg-confirm-password').style.borderColor = 'var(--sand)';

  const firstName = document.getElementById('reg-first-name').value.trim() || 'Usman';
  const lastName = document.getElementById('reg-last-name').value.trim() || 'Khan';
  userProfile.firstName = firstName;
  userProfile.lastName = lastName;

  goToHome();
}

function goToAuth() {
  show('auth');
  currentScreen = 'auth';
}

function switchAuthTab(tab) {
  document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
  event.target.classList.add('active');
  document.getElementById('form-login').classList.toggle('hidden', tab === 'register');
  document.getElementById('form-register').classList.toggle('hidden', tab === 'login');
}

function selectRole(el, role) {
  document.querySelectorAll('.role-btn').forEach(b => b.classList.remove('selected'));
  el.classList.add('selected');
  selectedRole = role;

  // Toggle registration extras
  document.getElementById('reg-owner-extras').style.display = role === 'owner' ? 'block' : 'none';
  document.getElementById('reg-minder-extras').style.display = role === 'minder' ? 'block' : 'none';
}

function handleCertUpload() {
  const input = document.getElementById('cert-upload-input');
  const names = Array.from(input.files).map(f => f.name).join(', ');
  document.getElementById('cert-file-names').textContent = '✅ ' + names;
}


// ===== NAVIGATION =====

function goToHome() {
  show('home');
  currentScreen = 'home';
  setNavActive('home');
  refreshPetsUI();
}

function switchTab(tab) {
  show(tab);
  currentScreen = tab;
  setNavActive(tab);
}

function setNavActive(tab) {
  document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
  const n = document.getElementById('nav-' + tab);
  if (n) n.classList.add('active');

  document.querySelectorAll('.bottom-nav').forEach(nav => {
    nav.querySelectorAll('.bottom-nav-item').forEach((btn, i) => {
      const tabs = ['home', 'search', 'bookings', 'messages', 'profile'];
      btn.classList.toggle('active', tabs[i] === tab);
    });
  });
}

function openMinderProfile() {
  previousScreen = currentScreen;
  show('minder-profile');
  currentScreen = 'minder-profile';
}

function openBooking() {
  previousScreen = currentScreen;
  show('booking');
  currentScreen = 'booking';
}

function goBack() {
  if (previousScreen) {
    show(previousScreen);
    currentScreen = previousScreen;
    setNavActive(previousScreen);
    previousScreen = null;
  } else {
    switchTab('home');
  }
}


// ===== MESSAGES =====

function messageMinder(chatId) {
  switchTab('messages');
  setTimeout(() => {
    const items = document.querySelectorAll('.chat-item');
    const map = { sarah: 0, emma: 1, james: 2 };
    if (map[chatId] !== undefined && items[map[chatId]]) {
      openChatInline(items[map[chatId]], chatId);
    }
  }, 100);
}

function openChatInline(el, chatId) {
  activeChat = chatId;
  const data = chatData[chatId];

  document.querySelectorAll('.chat-item').forEach(c => c.classList.remove('active-chat'));
  el.classList.add('active-chat');

  const u = el.querySelector('.chat-unread');
  if (u) u.remove();

  document.getElementById('chat-empty-state').style.display = 'none';
  const area = document.getElementById('chat-active-area');
  area.style.display = 'flex';

  document.getElementById('chat-active-avatar').textContent = data.avatar;
  document.getElementById('chat-active-name').textContent = data.name;
  document.getElementById('chat-active-status').innerHTML = data.online ? '● Online' : '● Offline';
  document.getElementById('chat-active-status').style.color = data.online ? '#4caf50' : '#999';

  const msgs = document.getElementById('chat-active-messages');
  msgs.innerHTML = '';
  data.messages.forEach(m => {
    const b = document.createElement('div');
    b.className = 'msg-bubble ' + (m.from === 'me' ? 'sent' : 'received');
    b.innerHTML = m.text + '<div class="msg-time">' + m.time + '</div>';
    msgs.appendChild(b);
  });
  msgs.scrollTop = msgs.scrollHeight;

  document.getElementById('messages-container').classList.add('chat-open');
}

function closeMobileChat() {
  document.getElementById('messages-container').classList.remove('chat-open');
}

function sendMessage() {
  const input = document.getElementById('chat-input-field');
  const text = input.value.trim();
  if (!text || !activeChat) return;

  const msgs = document.getElementById('chat-active-messages');
  const b = document.createElement('div');
  b.className = 'msg-bubble sent';
  b.innerHTML = text + '<div class="msg-time">Now</div>';
  msgs.appendChild(b);
  msgs.scrollTop = msgs.scrollHeight;

  chatData[activeChat].messages.push({ from: 'me', text, time: 'Now' });
  input.value = '';
}

document.getElementById('chat-input-field').addEventListener('keydown', e => {
  if (e.key === 'Enter') sendMessage();
});


// ===== MINDER PROFILE TABS =====

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

function selectService(el) {
  el.closest('.service-list').querySelectorAll('.service-option').forEach(o => o.classList.remove('selected'));
  el.classList.add('selected');
}

function selectDate(el) {
  document.querySelectorAll('.date-chip').forEach(d => d.classList.remove('selected'));
  el.classList.add('selected');
}

function selectTime(el) {
  if (el.classList.contains('unavailable')) return;
  document.querySelectorAll('.time-chip').forEach(t => t.classList.remove('selected'));
  el.classList.add('selected');
}

function toggleChip(el) {
  el.classList.toggle('active');
}


// ===== FILTER MODAL =====

function toggleFilterModal() {
  document.getElementById('filter-modal').classList.toggle('open');
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
    title.textContent = 'Add New Pet';
    del.style.display = 'none';
    saveBtn.textContent = 'Add Pet';
    document.getElementById('pet-name-input').value = '';
    document.getElementById('pet-type-input').value = 'Dog';
    document.getElementById('pet-breed-input').value = '';
    document.getElementById('pet-age-input').value = '';
    document.getElementById('pet-medical-input').value = '';
    document.getElementById('pet-care-input').value = '';
  } else {
    const pet = petData[petId];
    if (!pet) { showToast('Pet not found'); return; }
    title.textContent = 'Edit ' + pet.name;
    del.style.display = 'block';
    saveBtn.textContent = 'Save Changes';
    document.getElementById('pet-name-input').value = pet.name;
    document.getElementById('pet-type-input').value = pet.type;
    document.getElementById('pet-breed-input').value = pet.breed;
    document.getElementById('pet-age-input').value = pet.age;
    document.getElementById('pet-medical-input').value = pet.medical;
    document.getElementById('pet-care-input').value = pet.care;
  }

  modal.classList.add('open');
}

function closePetModal() {
  document.getElementById('pet-modal').classList.remove('open');
  currentEditPetId = null;
}

function savePet() {
  const petId = document.getElementById('pet-edit-id').value;
  const name = document.getElementById('pet-name-input').value.trim();
  const type = document.getElementById('pet-type-input').value;
  const breed = document.getElementById('pet-breed-input').value.trim();
  const age = document.getElementById('pet-age-input').value.trim();
  const medical = document.getElementById('pet-medical-input').value.trim();
  const care = document.getElementById('pet-care-input').value.trim();

  if (!name) {
    showToast('❌ Please enter a pet name');
    return;
  }

  if (petId === 'new') {
    // Add new pet
    const newId = name.toLowerCase().replace(/\s+/g, '_') + '_' + Date.now();
    petData[newId] = { name, type, breed, age, medical, care, emoji: petEmojis[type] || '🐾' };
    closePetModal();
    showToast('✅ ' + name + ' added successfully!');
    // Show reg confirmation if on registration
    const regAdded = document.getElementById('reg-pet-added');
    if (regAdded) regAdded.style.display = 'block';
    refreshPetsUI();
  } else {
    // Editing existing pet – confirm changes
    showConfirmModal(
      '💾',
      'Save Changes?',
      'Are you sure you want to save changes to ' + name + '?',
      function() {
        petData[petId].name = name;
        petData[petId].type = type;
        petData[petId].breed = breed;
        petData[petId].age = age;
        petData[petId].medical = medical;
        petData[petId].care = care;
        petData[petId].emoji = petEmojis[type] || '🐾';
        closePetModal();
        showToast('✅ ' + name + ' updated successfully!');
        refreshPetsUI();
      }
    );
  }
}

function confirmRemovePet() {
  const petId = document.getElementById('pet-edit-id').value;
  const pet = petData[petId];
  if (!pet) return;

  showConfirmModal(
    '🗑',
    'Remove ' + pet.name + '?',
    'Are you sure you want to remove ' + pet.name + '? This cannot be undone.',
    function() {
      delete petData[petId];
      closePetModal();
      showToast('🗑 ' + pet.name + ' removed');
      refreshPetsUI();
    }
  );
}

function refreshPetsUI() {
  // Update home pets grid
  const homeGrid = document.getElementById('home-pets-grid');
  if (homeGrid) {
    homeGrid.innerHTML = '';
    const ids = Object.keys(petData);
    ids.forEach(id => {
      const p = petData[id];
      const card = document.createElement('div');
      card.className = 'pet-card';
      card.onclick = () => openPetModal(id);
      card.innerHTML = '<div class="pet-emoji">' + (p.emoji || '🐾') + '</div><div class="pet-name">' + p.name + '</div><div class="pet-breed">' + p.breed + ' · ' + p.age + '</div>';
      homeGrid.appendChild(card);
    });
    // Add pet card
    const addCard = document.createElement('div');
    addCard.className = 'pet-add-card';
    addCard.onclick = () => openPetModal('new');
    addCard.innerHTML = '<div class="add-icon">＋</div>Add a Pet';
    homeGrid.appendChild(addCard);
  }

  // Update profile pets list
  const profileList = document.getElementById('profile-pets-list');
  if (profileList) {
    profileList.innerHTML = '';
    const ids = Object.keys(petData);
    ids.forEach(id => {
      const p = petData[id];
      const item = document.createElement('div');
      item.className = 'menu-item';
      item.onclick = () => openPetModal(id);
      item.innerHTML = '<span class="menu-icon">' + (p.emoji || '🐾') + '</span><span class="menu-label">' + p.name + '</span><span class="menu-arrow">›</span>';
      profileList.appendChild(item);
    });
  }

  // Update pet count
  const countEl = document.getElementById('home-pet-count');
  if (countEl) countEl.textContent = Object.keys(petData).length;

  // Update profile name
  const profileName = document.getElementById('profile-display-name');
  if (profileName) profileName.textContent = userProfile.firstName;

  const homeGreeting = document.querySelector('.home-greeting span');
  if (homeGreeting) homeGreeting.textContent = userProfile.firstName;
}


// ===== BOOKING PET SELECTION =====

function togglePetSelect(el, petId) {
  el.classList.toggle('selected');
  const check = el.querySelector('.pet-check');

  if (el.classList.contains('selected')) {
    check.style.opacity = '1';
    if (!selectedPets.includes(petId)) selectedPets.push(petId);
  } else {
    check.style.opacity = '0.3';
    selectedPets = selectedPets.filter(p => p !== petId);
  }

  if (selectedPets.length === 0) {
    el.classList.add('selected');
    check.style.opacity = '1';
    selectedPets.push(petId);
    showToast('You must select at least one pet');
    return;
  }

  updateBookingSummary();
}

function updateBookingSummary() {
  const names = { buddy: '🐕 Buddy', luna: '🐈 Luna' };
  document.getElementById('summary-pets').textContent = selectedPets.map(p => names[p] || p).join(' & ');

  const total = 15 + (selectedPets.length > 1 ? 5 * (selectedPets.length - 1) : 0);
  document.getElementById('summary-total').textContent = '£' + total.toFixed(2);
  document.getElementById('confirm-pay-btn').textContent = 'Confirm & Pay £' + total;
  document.getElementById('multi-pet-info').classList.toggle('visible', selectedPets.length > 1);
}

function confirmBooking() {
  showToast('✅ Booking sent to Sarah!');
  setTimeout(() => switchTab('bookings'), 1200);
}


// ===== REVIEWS =====

function setReviewStars(n) {
  reviewStars = n;
  const stars = document.querySelectorAll('#review-stars .star-btn');
  stars.forEach((s, i) => {
    s.classList.toggle('active', i < n);
  });
}

function submitReview() {
  const text = document.getElementById('review-text-input').value.trim();
  if (!text) {
    showToast('❌ Please write a review');
    return;
  }
  if (reviewStars === 0) {
    showToast('❌ Please select a star rating');
    return;
  }

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

function closeEditProfileModal() {
  document.getElementById('edit-profile-modal').classList.remove('open');
}

function saveProfile() {
  const fn = document.getElementById('edit-first-name').value.trim();
  const ln = document.getElementById('edit-last-name').value.trim();
  if (!fn) { showToast('❌ First name is required'); return; }

  showConfirmModal(
    '💾',
    'Save Profile Changes?',
    'Are you sure you want to update your profile?',
    function() {
      userProfile.firstName = fn;
      userProfile.lastName = ln;
      userProfile.email = document.getElementById('edit-email').value.trim();
      userProfile.phone = document.getElementById('edit-phone').value.trim();
      userProfile.location = document.getElementById('edit-location').value.trim();
      userProfile.bio = document.getElementById('edit-bio').value.trim();
      closeEditProfileModal();
      showToast('✅ Profile updated!');
      refreshPetsUI();
    }
  );
}


// ===== CONFIRM MODAL =====

let confirmCallback = null;

function showConfirmModal(icon, title, message, onConfirm) {
  document.getElementById('confirm-modal-icon').textContent = icon;
  document.getElementById('confirm-modal-title').textContent = title;
  document.getElementById('confirm-modal-message').textContent = message;
  confirmCallback = onConfirm;
  document.getElementById('confirm-modal-btn').onclick = function() {
    closeConfirmModal();
    if (confirmCallback) confirmCallback();
  };
  document.getElementById('confirm-modal').classList.add('open');
}

function closeConfirmModal() {
  document.getElementById('confirm-modal').classList.remove('open');
  confirmCallback = null;
}


// ===== LOGOUT =====

function confirmLogout() {
  showConfirmModal(
    '🚪',
    'Log Out?',
    'Are you sure you want to log out of your account?',
    function() {
      logout();
    }
  );
}

function logout() {
  isAdmin = false;
  show('landing');
  currentScreen = 'landing';
  const nav = document.getElementById('app-nav');
  if (nav) nav.classList.add('hidden');
  document.getElementById('mobile-header').style.display = 'none';
}


// ===== ADMIN FUNCTIONS =====

function switchAdminTab(btn, panelId) {
  document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  document.querySelectorAll('.admin-panel').forEach(p => p.style.display = 'none');
  document.getElementById(panelId).style.display = 'block';
}

function openAdminEditUser(userId) {
  const users = {
    usman: { name: 'Usman Khan', email: 'usman@email.com', role: 'Pet Owner', status: 'Active' },
    sarah: { name: 'Sarah K.', email: 'sarah@email.com', role: 'Pet Minder', status: 'Active' },
    james: { name: 'James M.', email: 'james@email.com', role: 'Pet Minder', status: 'Active' },
    emma: { name: 'Emma T.', email: 'emma@email.com', role: 'Pet Minder', status: 'Active' }
  };
  const user = users[userId];
  if (!user) return;

  document.getElementById('admin-edit-title').textContent = 'Edit ' + user.name;
  document.getElementById('admin-edit-name').value = user.name;
  document.getElementById('admin-edit-email').value = user.email;
  document.getElementById('admin-edit-role').value = user.role;
  document.getElementById('admin-edit-status').value = user.status;
  document.getElementById('admin-edit-modal').classList.add('open');
}

function closeAdminEditModal() {
  document.getElementById('admin-edit-modal').classList.remove('open');
}

function saveAdminEdit() {
  closeAdminEditModal();
  showToast('✅ User profile updated');
}

function adminSuspendUser(userId) {
  showConfirmModal(
    '⏸',
    'Suspend User?',
    'Are you sure you want to suspend this user account? They will be unable to log in.',
    function() {
      showToast('⏸ User account suspended');
    }
  );
}

function adminRemoveUser(userId) {
  showConfirmModal(
    '🗑',
    'Remove User?',
    'Are you sure you want to permanently remove this user account? This cannot be undone.',
    function() {
      showToast('🗑 User account removed');
    }
  );
}


// ===== TOAST =====

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2500);
}
