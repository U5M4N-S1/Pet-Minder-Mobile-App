require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const express = require('express');
const path = require('path');

const app = express();

app.use(express.json({ limit: '3mb' }));

// Serve the entire project as static files (HTML, CSS, JS)
app.use(express.static(path.join(__dirname, '..')));

// API routes
const authRoutes = require('./routes/auth');
app.use('/api/auth', authRoutes);
// The /minders handler inside auth.js is router.get('/minders', ...),
// so mount the router at /api so the full path is /api/minders (not /api/minders/minders).
app.use('/api', authRoutes);
app.use('/api/bookings', require('./routes/bookings'));
app.use('/api/pets',     require('./routes/pets'));
app.use('/api/admin',    require('./routes/admin'));

// Catch-all: any unmatched path serves the landing page
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`PawPal running → http://localhost:${PORT}`);
});
