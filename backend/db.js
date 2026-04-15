const low      = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');
const path     = require('path');
const bcrypt   = require('bcrypt');

const adapter = new FileSync(path.join(__dirname, 'pawpal.json'));
const db      = low(adapter);

// Seed the schema with empty collections if the file is brand new
db.defaults({ users: [], bookings: [], pets: [], disputes: [], notifications: [], reviews: [], chats: [], messages: [], routes: [] }).write();

// ── One-time migrations (safe to run repeatedly — no-ops if already done) ──
(function migrate() {
  let changed = false;
  db.get('users').value().forEach(u => {
    // Migrate legacy string role → array
    if (!Array.isArray(u.role)) {
      db.get('users').find({ id: u.id }).assign({ role: [u.role || 'owner'] }).value();
      changed = true;
    }
    // Migrate isMinder boolean → 'minder' in role array
    if (u.isMinder === true) {
      const roles = db.get('users').find({ id: u.id }).value().role;
      if (!roles.includes('minder')) {
        db.get('users').find({ id: u.id }).assign({ role: [...roles, 'minder'], isMinder: undefined }).value();
        changed = true;
      }
    }
  });
  if (changed) db.write();
}());

// Seed a default admin account if none exists.
(function seedAdmin() {
  const exists = db.get('users').find(u => Array.isArray(u.role) && u.role.includes('admin')).value();
  if (exists) return;
  const id = (db.get('users').maxBy('id').value() || { id: 0 }).id + 1;
  const passwordHash = bcrypt.hashSync('Admin2026!', 12);
  db.get('users').push({
    id,
    firstName: 'PawPal',
    lastName:  'Admin',
    email:     'pawpaladmin',
    passwordHash,
    role:      ['admin'],
    status:    'Active',
    location:  '',
    createdAt: new Date().toISOString()
  }).write();
}());

module.exports = db;
