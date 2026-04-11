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

// Run every hour, check for bookings happening in ~24h
setInterval(async () => {
  const tomorrow = new Date();
  tomorrow.setHours(tomorrow.getHours() + 24);
  const dateStr = tomorrow.toISOString().split('T')[0]; // YYYY-MM-DD

  const upcoming = db.get('bookings')
    .filter(b => b.bookingDate === dateStr && b.status === 'confirmed')
    .value();

  for (const booking of upcoming) {
    // Only send reminder if not already sent today
    const alreadySent = db.get('notifications')
      .find(n => n.bookingId === booking.id && n.title.includes('reminder'))
      .value();
    if (alreadySent) continue;

    notifier.saveNotification(booking.ownerId,
      '⏰ Booking reminder',
      `Your ${booking.service} with ${booking.minderName} is tomorrow at ${booking.bookingTime}`,
      booking.id
    );
    // email reminder too — call sendEmail directly or add a notifyReminder() function
  }
}, 60 * 60 * 1000); // every hour
