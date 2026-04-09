const low      = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');
const path     = require('path');

const adapter = new FileSync(path.join(__dirname, 'pawpal.json'));
const db      = low(adapter);

// Seed the schema with empty collections if the file is brand new
db.defaults({ users: [], bookings: [], pets: [] }).write();

module.exports = db;
