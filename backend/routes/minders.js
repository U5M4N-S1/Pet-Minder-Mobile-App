// backend/routes/minders.js
// Replaces the hacky app.use('/api', authRoutes) double-mount in server.js.
// Mount at /api/minders in server.js so the full path is GET /api/minders.

const express = require('express');
const db      = require('../db');

const router = express.Router();

// GET /api/minders — list all active pet minder accounts (public, no auth required)
router.get('/', (req, res) => {
  const minders = db.get('users')
    .filter(u => u.role === 'minder' && u.status !== 'Suspended' && u.status !== 'Banned')
    .value()
    .map(u => ({
      id:           u.id,
      name:         ((u.firstName || '') + ' ' + (u.lastName || '')).trim(),
      profileImage: u.profileImage || '',
      location:     u.serviceArea  || u.location || '',
      bio:          u.bio          || '',
      petsCaredFor: u.petsCaredFor || '',
      services:     u.services     || '',
      rate:         u.rate         || '',
      experience:   u.experience   || '',
      priceMin:     u.priceMin != null ? u.priceMin : 0,
      priceMax:     u.priceMax != null ? u.priceMax : 50
    }));
  res.json(minders);
});

module.exports = router;