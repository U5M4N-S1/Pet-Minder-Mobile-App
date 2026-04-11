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

// POST /api/admin/disputes — create a report
//   Accepts either the legacy payload ({ against, reason }) used by the
//   Help Centre "Report a user" flow OR a richer payload from the new
//   in-context reporting flow:
//     { reason, targetUserId, targetName, targetRole, context, bookingId }
//
//   Authorization rules for in-context reports:
//     • Pet owners may report any pet minder (context: 'minder-profile').
//     • Pet minders may only report a pet owner they have a booking with
//       (context: 'booking' + bookingId). The server verifies the booking
//       links the reporter (as minder) to the target (as owner).
//     • Admins may report anyone.
router.post('/disputes', requireAuth, (req, res) => {
  const {
    against, reason,
    targetUserId, targetName, targetRole,
    context, bookingId, chatId
  } = req.body;

  if (!reason || !String(reason).trim()) {
    return res.status(400).json({ error: 'Reason is required' });
  }

  const reporter = db.get('users').find({ id: req.user.userId }).value();
  if (!reporter) return res.status(401).json({ error: 'Unknown reporter' });
  const reporterName = ((reporter.firstName || '') + ' ' + (reporter.lastName || '')).trim() || 'Unknown';

  // Default: legacy payload — just pass the freeform `against` string
  // through. This preserves the existing Help Centre flow.
  let resolvedTargetId   = targetUserId != null ? Number(targetUserId) : null;
  let resolvedTargetName = targetName || against || 'Unknown';
  let resolvedTargetRole = targetRole || null;
  let resolvedContext    = context || 'help-centre';
  let resolvedBookingId  = bookingId != null ? Number(bookingId) : null;
  let resolvedChatId     = chatId != null ? Number(chatId) : null;

  // Chat-context reports: either party in an existing 1-on-1 chat can
  // report the other. The chat itself is the link between reporter and
  // target, so booking validation is skipped for this branch.
  if (resolvedContext === 'chat') {
    if (!resolvedChatId) {
      return res.status(400).json({ error: 'chatId is required for chat reports' });
    }
    const chat = db.get('chats').find({ id: resolvedChatId }).value();
    if (!chat) return res.status(404).json({ error: 'Chat not found' });
    if (chat.userA !== reporter.id && chat.userB !== reporter.id) {
      return res.status(403).json({ error: 'You are not a member of this chat' });
    }
    const otherId = chat.userA === reporter.id ? chat.userB : chat.userA;
    const other   = db.get('users').find({ id: otherId }).value();
    resolvedTargetId   = otherId;
    resolvedTargetName = other ? ((other.firstName || '') + ' ' + (other.lastName || '')).trim() : (resolvedTargetName || 'Unknown');
    resolvedTargetRole = other ? other.role : (resolvedTargetRole || null);
  }
  // Minder → owner reports require a booking that links them.
  else if (reporter.role === 'minder' && resolvedContext !== 'help-centre') {
    if (!resolvedBookingId) {
      return res.status(400).json({ error: 'Pet minders may only report a customer via an existing booking' });
    }
    const booking = db.get('bookings').find({ id: resolvedBookingId }).value();
    if (!booking) {
      return res.status(404).json({ error: 'Booking not found' });
    }
    if (Number(booking.minderKey) !== reporter.id) {
      return res.status(403).json({ error: 'You can only report customers from your own bookings' });
    }
    // Use the booking to derive the authoritative target info
    const owner = db.get('users').find({ id: booking.ownerId }).value();
    resolvedTargetId   = booking.ownerId;
    resolvedTargetName = owner ? ((owner.firstName || '') + ' ' + (owner.lastName || '')).trim() : (resolvedTargetName || 'Unknown');
    resolvedTargetRole = 'owner';
  }

  // Owner → minder reports: if targetUserId is provided, validate it points
  // at an actual minder account. Skipped for chat-context reports because
  // those are validated above by chat membership and may target either role.
  if (reporter.role === 'owner' && resolvedTargetId != null && resolvedContext !== 'chat') {
    const target = db.get('users').find({ id: resolvedTargetId }).value();
    if (!target) {
      return res.status(404).json({ error: 'Reported user not found' });
    }
    if (target.role !== 'minder') {
      return res.status(400).json({ error: 'Pet owners can only report pet minders' });
    }
    resolvedTargetName = ((target.firstName || '') + ' ' + (target.lastName || '')).trim() || resolvedTargetName;
    resolvedTargetRole = 'minder';
  }

  const dispute = {
    id:            nextDisputeId(),
    status:        'Open',
    date:          new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }),
    // Legacy fields (kept for backward compatibility with existing admin UI)
    from:          reporterName,
    against:       resolvedTargetName,
    reason:        String(reason).trim(),
    // New structured fields
    reporterId:    reporter.id,
    reporterRole:  reporter.role,
    targetUserId:  resolvedTargetId,
    targetRole:    resolvedTargetRole,
    context:       resolvedContext,
    bookingId:     resolvedBookingId,
    chatId:        resolvedChatId,
    createdAt:     new Date().toISOString()
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
