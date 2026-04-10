const express = require('express');
const bcrypt  = require('bcrypt');
const jwt     = require('jsonwebtoken');
const db      = require('../db');
const { requireAuth, JWT_SECRET } = require('../middleware/authMiddleware');

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
    phone:        u.phone     || '',
    bio:          u.bio       || '',
    profileImage: u.profileImage || '',
    // Minder-specific (empty strings for owners — frontend ignores them)
    serviceArea:  u.serviceArea  || '',
    petsCaredFor: u.petsCaredFor || '',
    services:     u.services     || '',
    rate:         u.rate         || '',
    experience:   u.experience   || '',
    priceMin:     u.priceMin     ?? 0,
    priceMax:     u.priceMax     ?? 50
  };
}

// ── Avatar upload limits (easy to tune) ───────────────────────────────
const AVATAR_MAX_BYTES  = 2 * 1024 * 1024; // 2 MB encoded (data-URI)
const AVATAR_MIME_ALLOW = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const AVATAR_MAX_DIM    = 1024; // px (width and height)

// POST /api/auth/signup
router.post('/signup', async (req, res) => {
  const { firstName, lastName, email, password, role } = req.body;

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
    const user = {
      id,
      firstName: firstName.trim(),
      lastName:  lastName.trim(),
      email:     email.toLowerCase(),
      passwordHash,
      role:      role || 'owner',
      location:  'London',
      createdAt: new Date().toISOString()
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

  const token = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, user: userDTO(user) });
});

// GET /api/auth/me
router.get('/me', requireAuth, (req, res) => {
  const user = db.get('users').find({ id: req.user.userId }).value();
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(userDTO(user));
});

// PATCH /api/auth/me — update profile fields
router.patch('/me', requireAuth, (req, res) => {
  const user = db.get('users').find({ id: req.user.userId });
  if (!user.value()) return res.status(404).json({ error: 'User not found' });

  const { firstName, lastName, email, phone, location, bio,
          serviceArea, petsCaredFor, services, rate, experience, priceMin, priceMax } = req.body;
  const updates = {};
  if (typeof firstName    === 'string' && firstName.trim()) updates.firstName    = firstName.trim();
  if (typeof lastName     === 'string') updates.lastName     = lastName.trim();
  if (typeof phone        === 'string') updates.phone        = phone.trim();
  if (typeof location     === 'string') updates.location     = location.trim();
  if (typeof bio          === 'string') updates.bio          = bio.trim();
  // Minder-specific fields
  if (typeof serviceArea  === 'string') updates.serviceArea  = serviceArea.trim();
  if (typeof petsCaredFor === 'string') updates.petsCaredFor = petsCaredFor.trim();
  if (typeof services     === 'string') updates.services     = services.trim();
  if (typeof rate         === 'string') updates.rate         = rate.trim();
  if (typeof experience   === 'string') updates.experience   = experience.trim();
  if (typeof priceMin     === 'number') updates.priceMin     = Math.max(0, Math.min(50, priceMin));
  if (typeof priceMax     === 'number') updates.priceMax     = Math.max(0, Math.min(50, priceMax));

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
      priceMin:     u.priceMin     ?? 0,
      priceMax:     u.priceMax     ?? 50
    }));
  res.json(minders);
});

module.exports = router;
