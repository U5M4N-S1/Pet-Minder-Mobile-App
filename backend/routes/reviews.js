const express = require('express');
const db      = require('../db');
const { requireAuth } = require('../middleware/authMiddleware');

const router = express.Router();

function nextId() {
  const last = db.get('reviews').maxBy('id').value();
  return last ? last.id + 1 : 1;
}

// GET /api/reviews/stats/all — aggregated avg rating + count for every minder
// Used by the search page to filter/sort by rating without N+1 requests.
router.get('/stats/all', (_req, res) => {
  const all = db.get('reviews').value() || [];
  const map = {};
  all.forEach(r => {
    if (!map[r.minderId]) map[r.minderId] = { total: 0, count: 0 };
    map[r.minderId].total += r.rating;
    map[r.minderId].count += 1;
  });
  const stats = {};
  for (const [id, s] of Object.entries(map)) {
    stats[id] = { avg: Math.round((s.total / s.count) * 10) / 10, count: s.count };
  }
  res.json(stats);
});

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
