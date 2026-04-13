const low      = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');
const path     = require('path');

const adapter = new FileSync(path.join(__dirname, 'pawpal.json'));
const db      = low(adapter);

// Seed the schema with empty collections if the file is brand new
db.defaults({ users: [], bookings: [], pets: [], disputes: [], notifications: [], reviews: [] }).write();

const bcrypt = require('bcrypt');

// ── Migration: convert any legacy string role to an array ─────────────
(function migrateRoles() {
  let changed = false;
  db.get('users').value().forEach(u => {
    if (!Array.isArray(u.role)) {
      db.get('users').find({ id: u.id }).assign({ role: [u.role || 'owner'] }).value();
      changed = true;
    }
    // Also migrate isMinder boolean → add 'minder' to role array
    if (u.isMinder === true && !db.get('users').find({ id: u.id }).value().role.includes('minder')) {
      const existing = db.get('users').find({ id: u.id }).value().role;
      db.get('users').find({ id: u.id }).assign({ role: [...existing, 'minder'], isMinder: undefined }).value();
      changed = true;
    }
  });
  if (changed) db.write();
}());

// Seed a default admin account if none exists.
// The admin can log in via the normal auth flow with role ['admin'].
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
