const low      = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');
const path     = require('path');

const adapter = new FileSync(path.join(__dirname, 'pawpal.json'));
const db      = low(adapter);

// Seed the schema with empty collections if the file is brand new
db.defaults({ users: [], bookings: [], pets: [], disputes: [], notifications: [], chats: [], messages: [], reviews: [] }).write();

// Seed a default admin account if none exists.
// The admin can log in via the normal auth flow with role 'admin'.
const bcrypt = require('bcrypt');
(function seedAdmin() {
  const exists = db.get('users').find({ role: 'admin' }).value();
  if (exists) return;
  const id = (db.get('users').maxBy('id').value() || { id: 0 }).id + 1;
  const passwordHash = bcrypt.hashSync('Admin2026!', 12);
  db.get('users').push({
    id,
    firstName: 'PawPal',
    lastName:  'Admin',
    email:     'pawpaladmin',
    passwordHash,
    role:      'admin',
    status:    'Active',
    location:  '',
    createdAt: new Date().toISOString()
  }).write();
}());

module.exports = db;
