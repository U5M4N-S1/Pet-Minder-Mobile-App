const jwt = require('jsonwebtoken');
const db  = require('../db');

const JWT_SECRET = process.env.JWT_SECRET || 'pawpal-dev-secret-change-before-deploying';

function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  try {
    const token = header.slice(7);
    req.user = jwt.verify(token, JWT_SECRET);

    // Reject suspended users even if their token is still valid
    const user = db.get('users').find({ id: req.user.userId }).value();
    if (user && user.status === 'Suspended') {
      return res.status(403).json({ error: 'Your account has been suspended. Please contact support.' });
    }

    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

module.exports = { requireAuth, JWT_SECRET };
