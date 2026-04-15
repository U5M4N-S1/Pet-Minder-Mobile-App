const express = require('express');
const bcrypt  = require('bcrypt');
const jwt     = require('jsonwebtoken');
const db      = require('../db');
const { requireAuth, JWT_SECRET } = require('../middleware/authMiddleware');
const { normalizeAvailability } = require('../lib/availability');

const router      = express.Router();
const SALT_ROUNDS = 12;

// ── Payout helpers ────────────────────────────────────────────────────
function maskSortCode(raw) {
  const d = String(raw || '').replace(/\D/g, '');
  return d.length === 6 ? '**-**-' + d.slice(4) : '';
}
function maskAccountNumber(raw) {
  const d = String(raw || '').replace(/\D/g, '');
  return d.length >= 4 ? '****' + d.slice(-4) : '';
}
function sanitisePayout(input) {
  if (!input || typeof input !== 'object') return null;
  const name = String(input.accountHolderName || '').trim().slice(0, 80);
  const bank = String(input.bankName || '').trim().slice(0, 80);
  const sort = String(input.sortCode || '').replace(/\D/g, '');
  const account = String(input.accountNumber || '').replace(/\D/g, '');
  if (!name || !bank || sort.length !== 6 || account.length !== 8) return null;
  return { accountHolderName: name, bankName: bank, sortCode: sort, accountNumber: account, updatedAt: new Date().toISOString() };
}

function nextId(collection) {
  const last = db.get(collection).maxBy('id').value();
  return last ? last.id + 1 : 1;
}

// ── Shared DTO builder ────────────────────────────────────────────────
// Returns a safe public user object (no passwordHash).
function userDTO(u) {
  return {
    id:           u.id,
    firstName:    u.firstName,
    lastName:     u.lastName,
    email:        u.email,
    role:         Array.isArray(u.role) ? u.role : [u.role || 'owner'],
    location:     u.location  || '',
    phone:        u.phone     || '',
    bio:          u.bio       || '',
    profileImage: u.profileImage || '',
    // Minder-specific (empty/zero for owners — frontend ignores them)
    serviceArea:     u.serviceArea     || '',
    petsCaredFor:    u.petsCaredFor    || '',
    services:        u.services        || '',
    rate:            u.rate            || '',
    experience:      u.experience      || '',
    priceMin:        u.priceMin != null ? u.priceMin : 10,
    priceMax:        u.priceMax != null ? u.priceMax : 25,
    availableForBooking: u.availableForBooking !== false, // default true
    enabledServices:  Array.isArray(u.enabledServices) ? u.enabledServices : [],
    // Per-day availability schedule (used for booking validation)
    availability:     normalizeAvailability(u),
    certificationTags: Array.isArray(u.certificationTags) ? u.certificationTags : [],
    qualificationImages: Array.isArray(u.qualificationImages) ? u.qualificationImages : [],
    servicePrices: (u.servicePrices && typeof u.servicePrices === 'object') ? u.servicePrices : {},
    online:           u.online === true && u.lastSeenAt &&
                      (Date.now() - new Date(u.lastSeenAt).getTime()) < 5 * 60 * 1000,
  };
}

// ── Avatar upload limits (easy to tune) ───────────────────────────────
const AVATAR_MAX_BYTES  = 2 * 1024 * 1024; // 2 MB encoded (data-URI)
const AVATAR_MIME_ALLOW = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const AVATAR_MAX_DIM    = 1024; // px (width and height)

// POST /api/auth/signup
router.post('/signup', async (req, res) => {
  const { firstName, lastName, email, password, role, priceMin, priceMax } = req.body;

  if (!firstName || !lastName || !email || !password) {
    return res.status(400).json({ error: 'All fields are required' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  const existing = db.get('users').find({ email: email.toLowerCase() }).value();
  if (existing) {
    return res.status(409).json({ error: 'An account with that email already exists' });
  }

  try {
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const id = nextId('users');
    const baseRole = role || 'owner';
    const isMinder = baseRole === 'minder';
    // Minders sign up as minder-only; they add the owner role when they add a pet.
    const roles = [baseRole];
    const user = {
      id,
      firstName: firstName.trim(),
      lastName:  lastName.trim(),
      email:     email.toLowerCase(),
      passwordHash,
      role:      roles,
      location:  'London',
      createdAt: new Date().toISOString(),
      // Minders get default services and availability flag
      ...(isMinder && {
        services:            'Walking, Home Visit',
        priceMin:            priceMin != null ? Math.max(1, Math.min(100, Number(priceMin) || 10)) : 10,
        priceMax:            priceMax != null ? Math.max(1, Math.min(100, Number(priceMax) || 25)) : 25,
        availableForBooking: true,
      }),
    };
    db.get('users').push(user).write();

    const token = jwt.sign({ userId: id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
    res.status(201).json({ token, user: userDTO(user) });
  } catch {
    res.status(500).json({ error: 'Server error, please try again' });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  const user = db.get('users').find({ email: email.toLowerCase() }).value();
  if (!user) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const match = await bcrypt.compare(password, user.passwordHash);
  if (!match) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  if (user.status === 'Suspended') {
    return res.status(403).json({ error: 'Your account has been suspended. Please contact support.' });
  }

  // Stamp online presence
  db.get('users').find({ id: user.id }).assign({ online: true, lastSeenAt: new Date().toISOString() }).write();
  const token = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, user: userDTO(user) });
});

// GET /api/auth/me
router.get('/me', requireAuth, (req, res) => {
  const user = db.get('users').find({ id: req.user.userId });
  if (!user.value()) return res.status(404).json({ error: 'User not found' });
  // Refresh presence heartbeat
  user.assign({ online: true, lastSeenAt: new Date().toISOString() }).write();
  res.json(userDTO(user.value()));
});

// PATCH /api/auth/me — update profile fields
router.patch('/me', requireAuth, (req, res) => {
  const user = db.get('users').find({ id: req.user.userId });
  if (!user.value()) return res.status(404).json({ error: 'User not found' });

  const { firstName, lastName, email, phone, location, bio,
          serviceArea, petsCaredFor, services, rate, experience,
          priceMin, priceMax, addMinderRole, minderServices, availableForBooking,
          certifications, certificationTags, availability, servicePrices, payout } = req.body;
  const updates = {};
  if (typeof firstName    === 'string' && firstName.trim()) updates.firstName    = firstName.trim();
  if (typeof lastName     === 'string') updates.lastName     = lastName.trim();
  if (typeof phone        === 'string') updates.phone        = phone.trim();
  if (typeof location     === 'string') updates.location     = location.trim();
  if (typeof bio          === 'string') updates.bio          = bio.trim();
  // Minder-specific fields
  if (typeof serviceArea  === 'string') updates.serviceArea  = serviceArea.trim();
  if (typeof petsCaredFor === 'string') updates.petsCaredFor = petsCaredFor.trim();
  if (Array.isArray(services)) {
    updates.services = services.join(', ');
  } else if (typeof services === 'string') {
    updates.services = services.trim();
  }
  if (typeof rate         === 'string') updates.rate         = rate.trim();
  if (typeof experience   === 'string') updates.experience   = experience.trim();
  // Price range (clamped 0–50)
  if (priceMin != null) updates.priceMin = Math.max(1, Math.min(100, Number(priceMin) || 1));
  if (priceMax != null) updates.priceMax = Math.max(1, Math.min(100, Number(priceMax) || 100));
  // Add minder role to the role array
  if (addMinderRole === true) {
    const currentRole = user.value().role;
    const roleArr = Array.isArray(currentRole) ? currentRole : [currentRole || 'owner'];
    if (!roleArr.includes('minder')) updates.role = [...roleArr, 'minder'];
  }
  if (Array.isArray(minderServices)) updates.minderServices = minderServices;
  // Toggle minder availability (on/off switch)
  if (availableForBooking !== undefined) updates.availableForBooking = !!availableForBooking;
  // Certifications stored as array only
  if (Array.isArray(certificationTags)) updates.certificationTags = certificationTags;
  // Per-service prices
  if (servicePrices && typeof servicePrices === 'object') {
    const cleaned = {};
    ['Walking','Home Visit','Grooming','Vet','Training'].forEach(k => {
      const n = Math.floor(Number(servicePrices[k]));
      if (isFinite(n) && n >= 0) cleaned[k] = Math.min(n, 999);
    });
    updates.servicePrices = cleaned;
  }
  // Payout details (minders only)
  if (payout) {
    const p = sanitisePayout(payout);
    if (p) updates.payout = p;
  }
  // Per-day availability schedule
  if (availability && typeof availability === 'object' && !Array.isArray(availability)) updates.availability = availability;

  // Email changes need a uniqueness check
  if (typeof email === 'string' && email.trim()) {
    const normalised = email.toLowerCase().trim();
    if (normalised !== user.value().email) {
      const clash = db.get('users').find({ email: normalised }).value();
      if (clash) return res.status(409).json({ error: 'That email is already in use' });
      updates.email = normalised;
    }
  }

  user.assign(updates).write();
  res.json(userDTO(user.value()));
});

// POST /api/auth/avatar — upload profile picture (base64 data URI)
// Body: { image: "data:image/png;base64,..." }
// Increase the JSON body limit for this route only.
router.post('/avatar', requireAuth, express.json({ limit: '3mb' }), (req, res) => {
  const { image } = req.body;
  if (!image || typeof image !== 'string') {
    return res.status(400).json({ error: 'No image provided' });
  }

  // Validate data-URI format
  const match = image.match(/^data:(image\/\w+);base64,/);
  if (!match) {
    return res.status(400).json({ error: 'Invalid image format. Must be a data URI (data:image/...;base64,...)' });
  }

  // Validate MIME type
  const mime = match[1];
  if (!AVATAR_MIME_ALLOW.includes(mime)) {
    return res.status(400).json({ error: 'Allowed image types: JPEG, PNG, WebP, GIF' });
  }

  // Validate size (the full data-URI string length is a close proxy)
  if (image.length > AVATAR_MAX_BYTES) {
    return res.status(400).json({ error: 'Image too large. Maximum 2 MB' });
  }

  // Decode and check dimensions via the raw bytes (JPEG/PNG header)
  const base64 = image.slice(match[0].length);
  const buf = Buffer.from(base64, 'base64');
  const dims = readImageDimensions(buf, mime);
  if (dims && (dims.width > AVATAR_MAX_DIM || dims.height > AVATAR_MAX_DIM)) {
    return res.status(400).json({ error: 'Image dimensions too large. Maximum ' + AVATAR_MAX_DIM + 'x' + AVATAR_MAX_DIM + ' px' });
  }

  const user = db.get('users').find({ id: req.user.userId });
  if (!user.value()) return res.status(404).json({ error: 'User not found' });

  user.assign({ profileImage: image }).write();
  res.json({ profileImage: image });
});

// DELETE /api/auth/avatar — remove profile picture
router.delete('/avatar', requireAuth, (req, res) => {
  const user = db.get('users').find({ id: req.user.userId });
  if (!user.value()) return res.status(404).json({ error: 'User not found' });
  user.assign({ profileImage: '' }).write();
  res.status(204).end();
});

// POST /api/auth/qualifications — upload a qualification image (PNG only)
// Body: { image: "data:image/png;base64,..." }
// Appends to the user's qualificationImages array (max 10 files).
router.post('/qualifications', requireAuth, express.json({ limit: '4mb' }), (req, res) => {
  const { image } = req.body;
  if (!image || typeof image !== 'string') return res.status(400).json({ error: 'No image provided' });

  const match = image.match(/^data:(image\/png);base64,/);
  if (!match) return res.status(400).json({ error: 'Only PNG images are accepted' });

  if (image.length > 3 * 1024 * 1024) return res.status(400).json({ error: 'Image too large. Maximum 3 MB' });

  const userRow = db.get('users').find({ id: req.user.userId });
  if (!userRow.value()) return res.status(404).json({ error: 'User not found' });

  const existing = Array.isArray(userRow.value().qualificationImages) ? userRow.value().qualificationImages : [];
  if (existing.length >= 10) return res.status(400).json({ error: 'Maximum 10 qualification images allowed' });

  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const newEntry = { id, image, uploadedAt: new Date().toISOString() };
  userRow.assign({ qualificationImages: [...existing, newEntry] }).write();

  res.status(201).json({ id, uploadedAt: newEntry.uploadedAt });
});

// DELETE /api/auth/qualifications/:id — remove one qualification image
router.delete('/qualifications/:imageId', requireAuth, (req, res) => {
  const userRow = db.get('users').find({ id: req.user.userId });
  if (!userRow.value()) return res.status(404).json({ error: 'User not found' });
  const existing = Array.isArray(userRow.value().qualificationImages) ? userRow.value().qualificationImages : [];
  userRow.assign({ qualificationImages: existing.filter(q => q.id !== req.params.imageId) }).write();
  res.status(204).end();
});

// ── Lightweight image dimension reader (no external deps) ─────────────
function readImageDimensions(buf, mime) {
  try {
    if (mime === 'image/png') {
      // PNG: width at bytes 16-19, height at 20-23 (big-endian)
      if (buf.length >= 24 && buf[0] === 0x89 && buf[1] === 0x50) {
        return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
      }
    } else if (mime === 'image/jpeg') {
      // JPEG: scan for SOF0/SOF2 markers (0xFF 0xC0 / 0xFF 0xC2)
      let i = 2;
      while (i < buf.length - 8) {
        if (buf[i] === 0xFF) {
          const marker = buf[i + 1];
          if (marker === 0xC0 || marker === 0xC2) {
            return { width: buf.readUInt16BE(i + 7), height: buf.readUInt16BE(i + 5) };
          }
          const segLen = buf.readUInt16BE(i + 2);
          i += 2 + segLen;
        } else { i++; }
      }
    } else if (mime === 'image/gif') {
      // GIF: width at bytes 6-7, height at 8-9 (little-endian)
      if (buf.length >= 10) {
        return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
      }
    }
    // WebP/other: skip dimension check (still validated by size + mime)
  } catch { /* malformed — skip dimension check */ }
  return null;
}

// POST /api/auth/forgot-password — generate a 6-digit reset code for the account
router.post('/forgot-password', (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email is required' });

  const user = db.get('users').find({ email: email.toLowerCase().trim() });
  if (!user.value()) return res.status(404).json({ error: 'No account found with that email' });

  const code = String(Math.floor(100000 + Math.random() * 900000));
  user.assign({ resetCode: code, resetCodeExpires: Date.now() + 10 * 60 * 1000 }).write();
  // In production this would be emailed — here we return it for the UI to display
  res.json({ code, email: user.value().email });
});

// POST /api/auth/reset-password — verify code and set new password
router.post('/reset-password', async (req, res) => {
  const { email, code, newPassword } = req.body;
  if (!email || !code || !newPassword) return res.status(400).json({ error: 'All fields are required' });
  if (newPassword.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });

  const user = db.get('users').find({ email: email.toLowerCase().trim() });
  const u = user.value();
  if (!u) return res.status(404).json({ error: 'No account found with that email' });
  if (!u.resetCode || u.resetCode !== code) return res.status(400).json({ error: 'Invalid verification code' });
  if (u.resetCodeExpires && Date.now() > u.resetCodeExpires) return res.status(400).json({ error: 'Verification code has expired' });

  try {
    const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
    user.assign({ passwordHash, resetCode: null, resetCodeExpires: null }).write();
    res.json({ message: 'Password reset successfully' });
  } catch {
    res.status(500).json({ error: 'Server error, please try again' });
  }
});

// GET /api/minders — list all active petminder accounts (public, no auth required)
router.get('/minders', requireAuth, (req, res) => {
  const minders = db.get('users')
    .filter(u => {
      const roles = Array.isArray(u.role) ? u.role : [u.role];
      return (u.id !== req.user.userId && 
        u.services !== "" &&
        roles.includes('minder') && 
        u.status !== 'Suspended' && 
        u.status !== 'Banned' && 
        u.availableForBooking !== false); // exclude minders who toggled off
    })
    .value()
    .map(u => {
      // Compute average rating from reviews collection
      const reviews = db.get('reviews').filter({ minderId: u.id }).value();
      const reviewCount = reviews.length;
      const avgRating = reviewCount
        ? (reviews.reduce((sum, r) => sum + r.stars, 0) / reviewCount).toFixed(1)
        : null;
      return {
        id:             u.id,
        name:           ((u.firstName || '') + ' ' + (u.lastName || '')).trim(),
        profileImage:   u.profileImage || '',
        location:       u.serviceArea || u.location || '',
        bio:            u.bio          || '',
        petsCaredFor:   u.petsCaredFor || '',
        services:       [...new Set([
                          ...(u.services || '').split(',').map(s => s.trim()).filter(Boolean),
                          ...(Array.isArray(u.enabledServices) ? u.enabledServices : [])
                        ])].join(', '),
        rate:           u.rate         || '',
        experience:     u.experience   || '',
        priceMin:       u.priceMin != null ? u.priceMin : 10,
        priceMax:       u.priceMax != null ? u.priceMax : 25,
        avgRating,
        reviewCount,
        availability:       normalizeAvailability(u),
        certificationTags:  Array.isArray(u.certificationTags) ? u.certificationTags : [],
        servicePrices:      (u.servicePrices && typeof u.servicePrices === 'object') ? u.servicePrices : {},
        online:         u.online === true && u.lastSeenAt &&
                        (Date.now() - new Date(u.lastSeenAt).getTime()) < 5 * 60 * 1000,
      };
    });
  res.json(minders);
});


// PATCH /api/auth/me/service-applications — minder applies for advanced services
// Body: { services: ['Grooming', 'Vet', 'Training'] }
// Saves pendingServices to the user and pushes a notification to every admin.
router.patch('/me/service-applications', requireAuth, (req, res) => {
  const user = db.get('users').find({ id: req.user.userId });
  if (!user.value()) return res.status(404).json({ error: 'User not found' });

  const roles = Array.isArray(user.value().role) ? user.value().role : [user.value().role || ''];
  // Auto-grant minder role if the user is an owner applying to become a minder
  if (!roles.includes('minder')) {
    if (roles.includes('owner')) {
      const updatedRoles = [...roles, 'minder'];
      user.assign({ role: updatedRoles }).write();
    } else {
      return res.status(403).json({ error: 'Only minders can apply for services' });
    }
  }

  const ADVANCED = ['Grooming', 'Vet', 'Training'];
  const requested = (Array.isArray(req.body.services) ? req.body.services : [])
    .filter(s => ADVANCED.includes(s));
  if (!requested.length) return res.status(400).json({ error: 'No valid services provided' });

  user.assign({ pendingServices: requested }).write();
  const u = user.value();
  const minderName = ((u.firstName || '') + ' ' + (u.lastName || '')).trim() || 'A minder';

  // Notify every admin
  const admins = db.get('users').filter(a => {
    const r = Array.isArray(a.role) ? a.role : [a.role || ''];
    return r.includes('admin');
  }).value();

  const notifBase = db.get('notifications').maxBy('id').value();
  let nextId = notifBase ? notifBase.id + 1 : 1;

  admins.forEach(admin => {
    db.get('notifications').push({
      id:        nextId++,
      userId:    admin.id,
      type:      'service_application',
      applicantId: u.id,
      title:     'Service application from ' + minderName,
      message:   minderName + ' has applied to offer: ' + requested.join(', ') + '. Review their profile to approve.',
      read:      false,
      createdAt: new Date().toISOString()
    }).write();
  });

  res.json({ pendingServices: requested });
});

// GET /api/auth/payout — returns masked payout details (minders only)
router.get('/payout', requireAuth, (req, res) => {
  const user = db.get('users').find({ id: req.user.userId }).value();
  if (!user) return res.status(404).json({ error: 'User not found' });
  const roles = Array.isArray(user.role) ? user.role : [user.role || ''];
  if (!roles.includes('minder')) return res.status(403).json({ error: 'Payout details are only available for minders' });
  const p = user.payout;
  if (!p) return res.json({ hasPayout: false });
  res.json({
    hasPayout:           true,
    accountHolderName:   p.accountHolderName || '',
    bankName:            p.bankName || '',
    sortCodeMasked:      maskSortCode(p.sortCode),
    accountNumberMasked: maskAccountNumber(p.accountNumber),
    updatedAt:           p.updatedAt || ''
  });
});

// PUT /api/auth/payout — saves payout details (minders only)
router.put('/payout', requireAuth, (req, res) => {
  const row = db.get('users').find({ id: req.user.userId });
  const u = row.value();
  if (!u) return res.status(404).json({ error: 'User not found' });
  const roles = Array.isArray(u.role) ? u.role : [u.role || ''];
  if (!roles.includes('minder')) return res.status(403).json({ error: 'Payout details are only available for minders' });
  const payout = sanitisePayout(req.body);
  if (!payout) return res.status(400).json({ error: 'All payout fields required (sort code 6 digits, account 8 digits)' });
  row.assign({ payout }).write();
  res.json({
    hasPayout:           true,
    accountHolderName:   payout.accountHolderName,
    bankName:            payout.bankName,
    sortCodeMasked:      maskSortCode(payout.sortCode),
    accountNumberMasked: maskAccountNumber(payout.accountNumber),
    updatedAt:           payout.updatedAt
  });
});

// POST /api/auth/logout — marks the user offline immediately
router.post('/logout', requireAuth, (req, res) => {
  db.get('users').find({ id: req.user.userId })
    .assign({ online: false, lastSeenAt: null })
    .write();
  res.status(204).end();
});

module.exports = router;
