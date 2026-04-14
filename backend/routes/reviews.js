const express = require('express');
const db      = require('../db');
const { requireAuth } = require('../middleware/authMiddleware');

const router = express.Router();

function nextId() {
  const last = db.get('reviews').maxBy('id').value();
  return last ? last.id + 1 : 1;
}

// GET /api/reviews/stats/all — aggregated avg + count per minder (for search page)
router.get('/stats/all', (_req, res) => {
  const all = db.get('reviews').value() || [];
  const map = {};
  all.forEach(r => {
    const stars = r.stars || r.rating || 0;
    if (!map[r.minderId]) map[r.minderId] = { total: 0, count: 0 };
    map[r.minderId].total += stars;
    map[r.minderId].count += 1;
  });
  const stats = {};
  for (const [id, s] of Object.entries(map)) {
    stats[id] = { avg: Math.round((s.total / s.count) * 10) / 10, count: s.count };
  }
  res.json(stats);
});

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

// POST /api/reviews — submit a review for a minder (owner role required)
router.post('/', requireAuth, (req, res) => {
  // Only pet owners may leave reviews
  const reviewer = db.get('users').find({ id: req.user.userId }).value();
  const reviewerRoles = Array.isArray(reviewer && reviewer.role) ? reviewer.role : [reviewer && reviewer.role || ''];
  if (!reviewerRoles.includes('owner')) {
    return res.status(403).json({ error: 'Only pet owners can leave reviews.' });
  }
  const { minderId, text } = req.body;
  const stars = Number(req.body.stars || req.body.rating || 0);
  if (!minderId) return res.status(400).json({ error: 'minderId is required' });
  if (!stars || stars < 1 || stars > 5) return res.status(400).json({ error: 'stars must be 1–5' });
  if (!text || !text.trim()) return res.status(400).json({ error: 'Review text is required' });

  const minder = db.get('users').find({ id: Number(minderId) }).value();
  if (!minder) return res.status(404).json({ error: 'Minder not found' });
  const minderRoles = Array.isArray(minder.role) ? minder.role : [minder.role || ''];
  if (!minderRoles.includes('minder')) return res.status(400).json({ error: 'User is not a minder' });

  // Prevent reviewing yourself
  if (Number(minderId) === req.user.userId) {
    return res.status(400).json({ error: 'You cannot review yourself' });
  }

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

// DELETE /api/reviews/:id — reviewer deletes their own review
router.delete('/:id', requireAuth, (req, res) => {
  const id  = Number(req.params.id);
  const row = db.get('reviews').find({ id });
  const rev = row.value();
  if (!rev) return res.status(404).json({ error: 'Review not found' });
  if (rev.reviewerId !== req.user.userId) return res.status(403).json({ error: 'You can only delete your own reviews' });
  db.get('reviews').remove({ id }).write();
  res.status(204).end();
});

// GET /api/reviews/mine — all reviews written by the logged-in user
router.get('/mine', requireAuth, (req, res) => {
  const reviews = db.get('reviews')
    .filter({ reviewerId: req.user.userId })
    .sortBy('createdAt')
    .value()
    .reverse();
  // Attach minder name to each review
  const enriched = reviews.map(r => {
    const minder = db.get('users').find({ id: r.minderId }).value();
    return {
      ...r,
      minderName: minder ? ((minder.firstName || '') + ' ' + (minder.lastName || '')).trim() : 'Unknown Minder'
    };
  });
  res.json(enriched);
});

module.exports = router;
