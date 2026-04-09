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
    res.status(201).json({
      token,
      user: { id, firstName: user.firstName, lastName: user.lastName, email: user.email, role: user.role, location: user.location }
    });
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
  res.json({
    token,
    user: { id: user.id, firstName: user.firstName, lastName: user.lastName, email: user.email, role: user.role, location: user.location }
  });
});

// GET /api/auth/me
router.get('/me', requireAuth, (req, res) => {
  const user = db.get('users').find({ id: req.user.userId }).value();
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ id: user.id, firstName: user.firstName, lastName: user.lastName, email: user.email, role: user.role, location: user.location });
});

module.exports = router;
