const express = require('express');
const db      = require('../db');
const { requireAuth } = require('../middleware/authMiddleware');

const router = express.Router();

// Middleware: only users with role === 'admin' may access these endpoints.
function requireAdmin(req, res, next) {
  const user = db.get('users').find({ id: req.user.userId }).value();
  if (!user || user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

// Map internal role keys to display labels and vice-versa
const ROLE_LABELS = { owner: 'Pet Owner', minder: 'Pet Minder', admin: 'Admin' };
const ROLE_KEYS   = { 'pet owner': 'owner', 'pet minder': 'minder', 'admin': 'admin' };
function roleLabel(key)   { return ROLE_LABELS[key] || key; }
function roleKey(label)   { return ROLE_KEYS[label.toLowerCase()] || label; }

// ─── USERS ───────────────────────────────────────────────────────────
// GET /api/admin/users — list every registered account
router.get('/users', requireAuth, requireAdmin, (_req, res) => {
  const users = db.get('users').value().map(u => ({
    id:     u.id,
    name:   ((u.firstName || '') + ' ' + (u.lastName || '')).trim(),
    email:  u.email,
    role:   roleLabel(u.role || 'owner'),
    status: u.status || 'Active',
    avatar: '👤'
  }));
  res.json(users);
});

// PATCH /api/admin/users/:id — edit name / email / role / status
router.patch('/users/:id', requireAuth, requireAdmin, (req, res) => {
  const id  = Number(req.params.id);
  const row = db.get('users').find({ id });
  if (!row.value()) return res.status(404).json({ error: 'User not found' });

  const { name, email, role, status } = req.body;
  const updates = {};
  if (typeof name === 'string' && name.trim()) {
    const parts = name.trim().split(/\s+/);
    updates.firstName = parts[0];
    updates.lastName  = parts.slice(1).join(' ');
  }
  if (typeof email  === 'string' && email.trim())  updates.email  = email.trim().toLowerCase();
  if (typeof role   === 'string' && role.trim())    updates.role   = roleKey(role.trim());
  if (typeof status === 'string' && status.trim())  updates.status = status.trim();

  row.assign(updates).write();
  const u = row.value();
  res.json({
    id:     u.id,
    name:   ((u.firstName || '') + ' ' + (u.lastName || '')).trim(),
    email:  u.email,
    role:   roleLabel(u.role),
    status: u.status || 'Active',
    avatar: '👤'
  });
});

// DELETE /api/admin/users/:id — permanently remove a user + their pets + bookings
router.delete('/users/:id', requireAuth, requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const user = db.get('users').find({ id }).value();
  if (!user) return res.status(404).json({ error: 'User not found' });

  db.get('users').remove({ id }).write();
  db.get('pets').remove({ ownerId: id }).write();
  db.get('bookings').remove({ ownerId: id }).write();

  res.status(204).end();
});

// ─── DISPUTES ────────────────────────────────────────────────────────
function nextDisputeId() {
  const last = db.get('disputes').maxBy('id').value();
  return last ? last.id + 1 : 1;
}

// GET /api/admin/disputes — list all disputes (any status)
router.get('/disputes', requireAuth, requireAdmin, (_req, res) => {
  const disputes = db.get('disputes').sortBy('id').value();
  res.json(disputes);
});

// POST /api/admin/disputes — create (used by the Report User flow)
router.post('/disputes', requireAuth, (req, res) => {
  const { against, reason } = req.body;
  if (!reason) return res.status(400).json({ error: 'Reason is required' });

  const reporter = db.get('users').find({ id: req.user.userId }).value();
  const dispute = {
    id:     nextDisputeId(),
    status: 'Open',
    date:   new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }),
    from:   reporter ? (reporter.firstName + ' ' + reporter.lastName) : 'Unknown',
    against: against || 'Unknown',
    reason:  reason.trim(),
    createdAt: new Date().toISOString()
  };
  db.get('disputes').push(dispute).write();
  res.status(201).json(dispute);
});

// PATCH /api/admin/disputes/:id — update status (Resolved / Dismissed)
router.patch('/disputes/:id', requireAuth, requireAdmin, (req, res) => {
  const id  = Number(req.params.id);
  const row = db.get('disputes').find({ id });
  if (!row.value()) return res.status(404).json({ error: 'Dispute not found' });

  const { status } = req.body;
  if (!status) return res.status(400).json({ error: 'Status is required' });

  row.assign({ status: status.trim() }).write();
  res.json(row.value());
});

module.exports = router;
