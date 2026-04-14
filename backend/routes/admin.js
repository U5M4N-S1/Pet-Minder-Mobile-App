const ADVANCED_SERVICES = ['Grooming', 'Vet', 'Training'];

const express = require('express');
const db      = require('../db');
const { requireAuth } = require('../middleware/authMiddleware');

const router = express.Router();

// Middleware: only users with role array containing 'admin' may access these endpoints.
function requireAdmin(req, res, next) {
  const user = db.get('users').find({ id: req.user.userId }).value();
  const roles = user && (Array.isArray(user.role) ? user.role : [user.role]);
  if (!roles || !roles.includes('admin')) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

// Map internal role keys to display labels and vice-versa
const ROLE_LABELS = { owner: 'Pet Owner', minder: 'Pet Minder', admin: 'Admin' };
function roleLabel(roleArr) {
  if (!Array.isArray(roleArr)) roleArr = [roleArr];
  return roleArr.map(r => ROLE_LABELS[r] || r).join(' & ');
}
function roleKey(label) {
  // Accept a display label like "Pet Owner" or "Pet Minder" and return the key
  const map = { 'pet owner': 'owner', 'pet minder': 'minder', 'admin': 'admin' };
  return map[label.toLowerCase().trim()] || label.toLowerCase().trim();
}

// ─── USERS ───────────────────────────────────────────────────────────
// GET /api/admin/users — list every registered account
router.get('/users', requireAuth, requireAdmin, (_req, res) => {
  const users = db.get('users').value().map(u => {
    const roles = Array.isArray(u.role) ? u.role : [u.role || 'owner'];
    return {
      id:               u.id,
      name:             ((u.firstName || '') + ' ' + (u.lastName || '')).trim(),
      email:            u.email,
      role:             roleLabel(roles), // may need to change back roleLabel(Array.isArray(u.role) ? u.role : [u.role || 'owner'])
      rawRoles:         roles,
      status:           u.status || 'Active',
      avatar:           '👤',
      profileImage:     u.profileImage || '',
      // Minder-specific
      services:         u.services        || '',
      enabledServices:  Array.isArray(u.enabledServices) ? u.enabledServices : [],
      serviceArea:      u.serviceArea     || '',
      experience:       u.experience      || '',
      priceMin:         u.priceMin != null ? u.priceMin : 0,
      priceMax:         u.priceMax != null ? u.priceMax : 50,
      availableForBooking: u.availableForBooking !== false,
      pendingServices:       Array.isArray(u.pendingServices) ? u.pendingServices : [],
      qualificationImages:   Array.isArray(u.qualificationImages) ? u.qualificationImages : [],
    };
  });
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
  // Role: the admin edit modal only changes the *primary* display role (owner/minder).
  // We never strip existing roles — a dual-role user keeps both. We only add a role
  // that isn't already present. Admins who need full control should use the service
  // toggles or status field instead.
  if (typeof role === 'string' && role.trim()) {
    const key = roleKey(role.trim());
    const currentRoles = Array.isArray(row.value().role) ? row.value().role : [row.value().role || 'owner'];
    // Only update if the requested key isn't already in the array
    if (!currentRoles.includes(key)) {
      // Replace the primary role (owner/minder) but keep admin or other extra roles
      const extras = currentRoles.filter(r => r !== 'owner' && r !== 'minder');
      updates.role = [key, ...extras];
    }
  }
  if (typeof status === 'string' && status.trim())  updates.status = status.trim();
  if (Array.isArray(req.body.pendingServices))       updates.pendingServices = req.body.pendingServices;

  row.assign(updates).write();
  const u = row.value();
  const updatedRoles = Array.isArray(u.role) ? u.role : [u.role || 'owner'];
  res.json({
    id:       u.id,
    name:     ((u.firstName || '') + ' ' + (u.lastName || '')).trim(),
    email:    u.email,
    role:     roleLabel(updatedRoles), // may need to change back roleLabel(Array.isArray(u.role) ? u.role : [u.role || 'owner']),
    rawRoles: updatedRoles,
    status:   u.status || 'Active',
    avatar:   '👤',
    profileImage: u.profileImage || '',
    services:        u.services || '',
    enabledServices: Array.isArray(u.enabledServices) ? u.enabledServices : [],
    serviceArea:     u.serviceArea || '',
    experience:      u.experience || '',
    priceMin:        u.priceMin != null ? u.priceMin : 0,
    priceMax:        u.priceMax != null ? u.priceMax : 50,
    availableForBooking: u.availableForBooking !== false,
    pendingServices:       Array.isArray(u.pendingServices) ? u.pendingServices : [],
    qualificationImages:   Array.isArray(u.qualificationImages) ? u.qualificationImages : [],
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
function nextNotifId() {
  const last = db.get('notifications').maxBy('id').value();
  return last ? last.id + 1 : 1;
}

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
    id:         nextDisputeId(),
    status:     'Open',
    reporterId: req.user.userId,
    date:       new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }),
    from:       reporter ? (reporter.firstName + ' ' + reporter.lastName) : 'Unknown',
    against:    against || 'Unknown',
    reason:     reason.trim(),
    createdAt:  new Date().toISOString()
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
  const dispute = row.value();

  // Notify the reporter of the outcome
  if (dispute.reporterId && (status === 'Resolved' || status === 'Dismissed')) {
    const isResolved = status === 'Resolved';
    db.get('notifications').push({
      id:        nextNotifId(),
      userId:    dispute.reporterId,
      type:      'dispute_outcome',
      title:     isResolved ? 'Your report has been resolved' : 'Your report has been dismissed',
      message:   isResolved
        ? 'An admin has reviewed your report against ' + dispute.against + ' and resolved it. Thank you for keeping PawPal safe.'
        : 'An admin has reviewed your report against ' + dispute.against + ' and dismissed it. No further action will be taken.',
      read:      false,
      createdAt: new Date().toISOString()
    }).write();
  }

  res.json(dispute);
});


// PATCH /api/admin/users/:id/services — enable/disable advanced services for a minder
// Body: { service: 'Grooming'|'Vet'|'Training', enabled: true|false }
router.patch('/users/:id/services', requireAuth, requireAdmin, (req, res) => {
  const id  = Number(req.params.id);
  const row = db.get('users').find({ id });
  const user = row.value();
  if (!user) return res.status(404).json({ error: 'User not found' });

  const roles = Array.isArray(user.role) ? user.role : [user.role || 'owner'];
  if (!roles.includes('minder')) return res.status(400).json({ error: 'User is not a minder' });

  const { service, enabled } = req.body;
  if (!ADVANCED_SERVICES.includes(service)) {
    return res.status(400).json({ error: 'Invalid service. Must be Grooming, Vet, or Training' });
  }

  // Update enabledServices array
  let enabledServices = Array.isArray(user.enabledServices) ? [...user.enabledServices] : [];
  if (enabled) {
    if (!enabledServices.includes(service)) enabledServices.push(service);
  } else {
    enabledServices = enabledServices.filter(s => s !== service);
  }

  // When enabling, remove the service from pendingServices (application resolved)
  let pendingServices = Array.isArray(user.pendingServices) ? [...user.pendingServices] : [];
  if (enabled) pendingServices = pendingServices.filter(s => s !== service);

  // When disabling, also strip the service from the minder's services string so
  // it doesn't linger in their profile or reappear on their next profile save.
  const updates = { enabledServices };
  if (!enabled) {
    const cleaned = (user.services || '').split(',')
      .map(s => s.trim())
      .filter(s => s && s !== service)
      .join(', ');
    updates.services = cleaned;
  }
  row.assign(updates).write();

  // Push a notification to the minder
  const action = enabled ? 'enabled' : 'disabled';
  const notifLast = db.get('notifications').maxBy('id').value();
  const notifId   = notifLast ? notifLast.id + 1 : 1;
  db.get('notifications').push({
    id:        notifId,
    userId:    id,
    type:      'service_update',
    title:     'Service ' + action + ': ' + service,
    message:   'An admin has ' + action + ' the ' + service + ' service on your minder profile.',
    read:      false,
    createdAt: new Date().toISOString()
  }).write();

  res.json({ id, enabledServices, pendingServices: row.value().pendingServices || [], services: row.value().services || '' });
});

// DELETE /api/admin/qualifications/:userId/:imageId — remove a qual image from a minder
router.delete('/qualifications/:userId/:imageId', requireAuth, requireAdmin, (req, res) => {
  const userId  = Number(req.params.userId);
  const imageId = req.params.imageId;
  const userRow = db.get('users').find({ id: userId });
  if (!userRow.value()) return res.status(404).json({ error: 'User not found' });
  const existing = Array.isArray(userRow.value().qualificationImages) ? userRow.value().qualificationImages : [];
  userRow.assign({ qualificationImages: existing.filter(q => q.id !== imageId) }).write();
  res.status(204).end();
});

module.exports = router;
