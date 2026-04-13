const express = require('express');
const db      = require('../db');
const { requireAuth } = require('../middleware/authMiddleware');

const router = express.Router();

function nextId() {
  const last = db.get('reviews').maxBy('id').value();
  return last ? last.id + 1 : 1;
}

// GET /api/reviews/minder/:id — fetch all reviews for a minder (public)
router.get('/minder/:id', (req, res) => {
  const minderId = Number(req.params.id);
  const reviews = db.get('reviews')
    .filter({ minderId })
    .sortBy('createdAt')
    .value()
    .reverse();

  // Compute average
  const avg = reviews.length
    ? (reviews.reduce((s, r) => s + r.stars, 0) / reviews.length).toFixed(1)
    : null;

  res.json({ reviews, average: avg, count: reviews.length });
});

// POST /api/reviews — submit a review for a minder
router.post('/', requireAuth, (req, res) => {
  const { minderId, stars, text } = req.body;
  if (!minderId) return res.status(400).json({ error: 'minderId is required' });
  if (!stars || stars < 1 || stars > 5) return res.status(400).json({ error: 'stars must be 1–5' });
  if (!text || !text.trim()) return res.status(400).json({ error: 'Review text is required' });

  const minder = db.get('users').find({ id: Number(minderId) }).value();
  if (!minder) return res.status(404).json({ error: 'Minder not found' });

  // Prevent reviewing yourself
  if (Number(minderId) === req.user.userId) {
    return res.status(400).json({ error: 'You cannot review yourself' });
  }

  const reviewer = db.get('users').find({ id: req.user.userId }).value();
  const review = {
    id:         nextId(),
    minderId:   Number(minderId),
    reviewerId: req.user.userId,
    reviewerName: reviewer
      ? ((reviewer.firstName || '') + ' ' + (reviewer.lastName || '')).trim()
      : 'Anonymous',
    stars:      Number(stars),
    text:       text.trim(),
    createdAt:  new Date().toISOString()
  };

  db.get('reviews').push(review).write();
  res.status(201).json(review);
});

module.exports = router;
