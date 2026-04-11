const express = require('express');
const db      = require('../db');
const { requireAuth } = require('../middleware/authMiddleware');

const router = express.Router();

function nextId() {
  const last = db.get('reviews').maxBy('id').value();
  return last ? last.id + 1 : 1;
}

// GET /api/reviews/:minderId — public list of reviews for a minder
router.get('/:minderId', (req, res) => {
  const minderId = Number(req.params.minderId);
  if (!minderId) return res.json([]);
  const list = db.get('reviews')
    .filter({ minderId })
    .sortBy('createdAt')
    .value()
    .reverse();
  res.json(list);
});

// POST /api/reviews — body: { minderId, rating (1-5), text }
router.post('/', requireAuth, (req, res) => {
  const minderId = Number(req.body && req.body.minderId);
  const rating   = Number(req.body && req.body.rating);
  const text     = String((req.body && req.body.text) || '').trim();

  if (!minderId)               return res.status(400).json({ error: 'minderId is required' });
  if (!(rating >= 1 && rating <= 5)) return res.status(400).json({ error: 'rating must be 1-5' });
  if (!text)                   return res.status(400).json({ error: 'review text is required' });

  const minder = db.get('users').find({ id: minderId, role: 'minder' }).value();
  if (!minder) return res.status(404).json({ error: 'Minder not found' });
  if (minderId === req.user.userId) return res.status(400).json({ error: 'You cannot review yourself' });

  const author = db.get('users').find({ id: req.user.userId }).value();
  const review = {
    id:         nextId(),
    minderId,
    authorId:   req.user.userId,
    authorName: author ? (((author.firstName || '') + ' ' + ((author.lastName || '').charAt(0) ? (author.lastName.charAt(0) + '.') : '')).trim() || author.email || 'User') : 'User',
    rating,
    text:       text.slice(0, 1000),
    createdAt:  new Date().toISOString()
  };
  db.get('reviews').push(review).write();
  res.status(201).json(review);
});

module.exports = router;
