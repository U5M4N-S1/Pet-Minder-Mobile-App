const express = require('express');
const bcrypt  = require('bcrypt');
const jwt     = require('jsonwebtoken');
const db      = require('../db');
const { requireAuth, JWT_SECRET } = require('../middleware/authMiddleware');
const { normalizeAvailability, VALID_DAYS, VALID_SLOTS } = require('../lib/availability');

const router      = express.Router();
const SALT_ROUNDS = 12;

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
    role:         u.role,
    location:     u.location  || '',
    locationLat:  typeof u.locationLat === 'number' ? u.locationLat : null,
    locationLng:  typeof u.locationLng === 'number' ? u.locationLng : null,
    phone:        u.phone     || '',
    bio:          u.bio       || '',
    profileImage: u.profileImage || '',
    // Minder-specific (empty/zero for owners — frontend ignores them)
    serviceArea:  u.serviceArea  || '',
    petsCaredFor: u.petsCaredFor || '',
    services:     u.services     || '',
    rate:         u.rate         || '',
    experience:   u.experience   || '',
    priceMin:     u.priceMin != null ? u.priceMin : 0,
    priceMax:     u.priceMax != null ? u.priceMax : 50,
    // Availability (per-day object; backward-compat with legacy flat arrays)
    availability:   normalizeAvailability(u),
    certifications: u.certifications || ''
  };
}

// ── Avatar upload limits (easy to tune) ───────────────────────────────
const AVATAR_MAX_BYTES  = 2 * 1024 * 1024; // 2 MB encoded (data-URI)
const AVATAR_MIME_ALLOW = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const AVATAR_MAX_DIM    = 1024; // px (width and height)

// ── Payout helpers (demo only — raw digits stay server-side, masked in UI)
function maskSortCode(raw) {
  const d = String(raw || '').replace(/\D/g, '');
  if (d.length !== 6) return '';
  return '**-**-' + d.slice(4);
}
function maskAccountNumber(raw) {
  const d = String(raw || '').replace(/\D/g, '');
  if (d.length < 4) return '';
  return '****' + d.slice(-4);
}
function sanitisePayout(input) {
  if (!input || typeof input !== 'object') return null;
  const name    = String(input.accountHolderName || '').trim().slice(0, 80);
  const bank    = String(input.bankName || '').trim().slice(0, 80);
  const sort    = String(input.sortCode || '').replace(/\D/g, '');
  const account = String(input.accountNumber || '').replace(/\D/g, '');
  if (!name || !bank || sort.length !== 6 || account.length !== 8) return null;
  return { accountHolderName: name, bankName: bank, sortCode: sort, accountNumber: account, updatedAt: new Date().toISOString() };
}

// POST /api/auth/signup
router.post('/signup', async (req, res) => {
  const { firstName, lastName, email, password, role, location, locationLat, locationLng, payout } = req.body;

  if (!firstName || !lastName || !email || !password) {
    return res.status(400).json({ error: 'All fields are required' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  // Minder accounts must provide valid payout details at registration;
  // owner accounts skip the payout flow entirely.
  let payoutForUser = null;
  if (role === 'minder') {
    payoutForUser = sanitisePayout(payout);
    if (!payoutForUser) {
      return res.status(400).json({ error: 'Payout details are required for Pet Minder accounts (sort code 6 digits, account 8 digits)' });
    }
  }

  const existing = db.get('users').find({ email: email.toLowerCase() }).value();
  if (existing) {
    return res.status(409).json({ error: 'An account with that email already exists' });
  }

  try {
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const id = nextId('users');
    const user = {
      id,
      firstName: firstName.trim(),
      lastName:  lastName.trim(),
      email:     email.toLowerCase(),
      passwordHash,
      role:      role || 'owner',
      location:  (typeof location === 'string' && location.trim()) ? location.trim() : '',
      createdAt: new Date().toISOString()
    };
    if (Number.isFinite(locationLat) && Number.isFinite(locationLng) &&
        locationLat >= -90 && locationLat <= 90 && locationLng >= -180 && locationLng <= 180) {
      user.locationLat = locationLat;
      user.locationLng = locationLng;
    }
    if (payoutForUser) user.payout = payoutForUser;
    user.online     = true;
    user.lastSeenAt = new Date().toISOString();
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

  const token = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
  // Mark the account online + stamp lastSeenAt for the presence window.
  db.get('users').find({ id: user.id }).assign({ online: true, lastSeenAt: new Date().toISOString() }).write();
  res.json({ token, user: userDTO(user) });
});

// POST /api/auth/logout — flip online flag off. The JWT itself is stateless,
// so "logging out" just marks the user offline for presence display.
router.post('/logout', requireAuth, (req, res) => {
  db.get('users').find({ id: req.user.userId }).assign({ online: false, lastSeenAt: new Date().toISOString() }).write();
  res.json({ ok: true });
});

// GET /api/auth/me — also doubles as a presence heartbeat. Every page load
// refreshes lastSeenAt so a user who closed the tab naturally ages out of
// "online" after ~2 minutes without needing an explicit logout.
router.get('/me', requireAuth, (req, res) => {
  const user = db.get('users').find({ id: req.user.userId });
  if (!user.value()) return res.status(404).json({ error: 'User not found' });
  user.assign({ online: true, lastSeenAt: new Date().toISOString() }).write();
  res.json(userDTO(user.value()));
});

// GET /api/auth/payout — minder-only. Returns the saved payout details
// in masked form (never raw sort code / account number). Owners get 403.
router.get('/payout', requireAuth, (req, res) => {
  const user = db.get('users').find({ id: req.user.userId }).value();
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (user.role !== 'minder') return res.status(403).json({ error: 'Payout details are only available for Pet Minder accounts' });
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

// PUT /api/auth/payout — minder-only. Overwrites the saved payout details.
// Requires all four fields; partial updates are rejected to keep demo
// state coherent. The raw digits are stored server-side and never returned.
router.put('/payout', requireAuth, (req, res) => {
  const user = db.get('users').find({ id: req.user.userId });
  const u = user.value();
  if (!u) return res.status(404).json({ error: 'User not found' });
  if (u.role !== 'minder') return res.status(403).json({ error: 'Payout details are only available for Pet Minder accounts' });
  const payout = sanitisePayout(req.body);
  if (!payout) return res.status(400).json({ error: 'All payout fields are required (sort code 6 digits, account 8 digits)' });
  user.assign({ payout }).write();
  res.json({
    hasPayout:           true,
    accountHolderName:   payout.accountHolderName,
    bankName:            payout.bankName,
    sortCodeMasked:      maskSortCode(payout.sortCode),
    accountNumberMasked: maskAccountNumber(payout.accountNumber),
    updatedAt:           payout.updatedAt
  });
});

// POST /api/auth/become-minder — upgrade an existing owner account to a
// minder account. Reuses the name/email/location the user already registered
// with; only asks for the fields that are genuinely new (payout details).
// Minder-specific profile fields (service area, availability, price range,
// etc.) stay blank and are set later via PATCH /me from Edit Profile.
router.post('/become-minder', requireAuth, (req, res) => {
  const user = db.get('users').find({ id: req.user.userId });
  const u = user.value();
  if (!u) return res.status(404).json({ error: 'User not found' });
  if (u.role === 'minder') return res.status(400).json({ error: 'You are already a Pet Minder' });
  if (u.role !== 'owner')  return res.status(403).json({ error: 'Only pet owner accounts can upgrade to Pet Minder' });

  const payout = sanitisePayout(req.body && req.body.payout);
  if (!payout) {
    return res.status(400).json({ error: 'Payout details are required (sort code 6 digits, account 8 digits)' });
  }

  user.assign({ role: 'minder', payout }).write();
  res.json(userDTO(user.value()));
});

// PATCH /api/auth/me — update profile fields
router.patch('/me', requireAuth, (req, res) => {
  const user = db.get('users').find({ id: req.user.userId });
  if (!user.value()) return res.status(404).json({ error: 'User not found' });

  const { firstName, lastName, email, phone, location, locationLat, locationLng, bio,
          serviceArea, petsCaredFor, services, rate, experience,
          priceMin, priceMax,
          availability, certifications } = req.body;
  const updates = {};
  if (typeof firstName    === 'string' && firstName.trim()) updates.firstName    = firstName.trim();
  if (typeof lastName     === 'string') updates.lastName     = lastName.trim();
  if (typeof phone        === 'string') updates.phone        = phone.trim();
  if (typeof location     === 'string') updates.location     = location.trim();
  if (Number.isFinite(locationLat) && Number.isFinite(locationLng) &&
      locationLat >= -90 && locationLat <= 90 && locationLng >= -180 && locationLng <= 180) {
    updates.locationLat = locationLat;
    updates.locationLng = locationLng;
  }
  if (typeof bio          === 'string') updates.bio          = bio.trim();
  // Minder-specific fields
  if (typeof serviceArea  === 'string') updates.serviceArea  = serviceArea.trim();
  if (typeof petsCaredFor === 'string') updates.petsCaredFor = petsCaredFor.trim();
  if (typeof services     === 'string') updates.services     = services.trim();
  if (typeof rate         === 'string') updates.rate         = rate.trim();
  if (typeof experience   === 'string') updates.experience   = experience.trim();
  // Price range (clamped 0–50)
  if (priceMin != null) updates.priceMin = Math.max(0, Math.min(50, Number(priceMin) || 0));
  if (priceMax != null) updates.priceMax = Math.max(0, Math.min(50, Number(priceMax) || 50));
  // Availability: per-day object { mon: ['morning','evening'], ... }
  // Validate each key is a known day and each value only contains known slots.
  if (availability != null && typeof availability === 'object' && !Array.isArray(availability)) {
    const clean = {};
    for (const day of VALID_DAYS) {
      if (Array.isArray(availability[day])) {
        const slots = [...new Set(availability[day].map(s => String(s).toLowerCase()).filter(s => VALID_SLOTS.includes(s)))];
        if (slots.length) clean[day] = slots;
      }
    }
    updates.availability = clean;
  }
  // Certifications free-text (capped to avoid runaway payloads)
  if (typeof certifications === 'string') updates.certifications = certifications.trim().slice(0, 2000);

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
router.get('/minders', (req, res) => {
  const minders = db.get('users')
    .filter(u => u.role === 'minder' && u.status !== 'Suspended' && u.status !== 'Banned')
    .value()
    .map(u => ({
      id:           u.id,
      name:         ((u.firstName || '') + ' ' + (u.lastName || '')).trim(),
      profileImage: u.profileImage || '',
      location:     u.serviceArea || u.location || '',
      bio:          u.bio          || '',
      petsCaredFor: u.petsCaredFor || '',
      services:     u.services     || '',
      rate:         u.rate         || '',
      experience:   u.experience   || '',
      priceMin:     u.priceMin != null ? u.priceMin : 0,
      priceMax:     u.priceMax != null ? u.priceMax : 50,
      availability:   normalizeAvailability(u),
      certifications: u.certifications || ''
    }));
  res.json(minders);
});

module.exports = router;
