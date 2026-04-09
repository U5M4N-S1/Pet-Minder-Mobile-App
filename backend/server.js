require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const express = require('express');
const path = require('path');

const app = express();

app.use(express.json());

// Serve the entire project as static files (HTML, CSS, JS)
app.use(express.static(path.join(__dirname, '..')));

// API routes
app.use('/api/auth',     require('./routes/auth'));
app.use('/api/bookings', require('./routes/bookings'));

// Catch-all: any unmatched path serves the landing page
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`PawPal running → http://localhost:${PORT}`);
});
