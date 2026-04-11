const express = require('express');
const db      = require('../db');
const { requireAuth } = require('../middleware/authMiddleware');

const router = express.Router();

// GET /api/notifications — list notifications for the logged-in user, newest first
router.get('/', requireAuth, (req, res) => {
  const list = db.get('notifications')
    .filter({ userId: req.user.userId })
    .sortBy('createdAt')
    .value()
    .reverse();
  res.json(list);
});

// PATCH /api/notifications/:id — mark as read
router.patch('/:id', requireAuth, (req, res) => {
  const id  = Number(req.params.id);
  const row = db.get('notifications').find({ id });
  const n   = row.value();
  if (!n) return res.status(404).json({ error: 'Notification not found' });
  if (n.userId !== req.user.userId) return res.status(403).json({ error: 'Not your notification' });
  row.assign({ read: true }).write();
  res.json(row.value());
});

// DELETE /api/notifications/:id
router.delete('/:id', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const n  = db.get('notifications').find({ id }).value();
  if (!n) return res.status(404).json({ error: 'Notification not found' });
  if (n.userId !== req.user.userId) return res.status(403).json({ error: 'Not your notification' });
  db.get('notifications').remove({ id }).write();
  res.status(204).end();
});

module.exports = router;
