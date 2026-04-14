# PawPal – Feature List

## Auth
- Register as Owner or Minder (separate flows)
- Owners must add ≥1 pet to register
- Login / Logout
- Forgot password (6-digit code, 10 min expiry)
- JWT sessions, suspended users blocked at middleware

---

## Roles
- **Owner** – books minders, leaves reviews, messages
- **Minder** – accepts bookings, tracks walks, applies for services
- **Dual-role** – owner can become a minder via Profile
- **Admin** – manages users, disputes, qualifications

---

## Profile
- Edit name, email, phone, bio, location, profile picture
- Minders: service area, pets accepted, price range (£/hr), experience
- Certifications & qualifications – tag input, chips with delete
- Per-day availability grid (morning / afternoon / evening per day)
- Availability toggle (on/off hides minder from search)
- Upload PNG qualification images (max 3 MB, up to 10)
- Apply for advanced services (Grooming / Vet / Training) – goes to admin

---

## Pets
- Add, edit, remove pets
- Fields: name, type, breed, age (0–100), medical notes, care instructions

---

## Find Minders (Owners only)
- Search by location/postcode
- Sort: Nearest · Top Rated · Most Reviews · Price ↑↓
- Filter: pet type, service type, min rating, price range
- GPS distance badge via Nominatim geocoding
- Suspended / unavailable minders excluded
- Own listing shown as "Your listing"

---

## Minder Profile
- Bio, services, price, availability schedule, certifications, reviews
- Book Now (owners only, not own profile)
- Message button → opens/creates chat
- Report button

---

## Booking
- Select service, date (next 14 days), time (08:00–20:00), pets
- Time slots greyed if: minder unavailable, minder confirmed, pet already booked
- Multi-pet adds £5/extra pet
- Live booking summary
- Conflict checked client-side and server-side

### Owner actions
- View upcoming / past bookings
- Cancel pending or confirmed booking
- View live GPS location during walk

### Minder actions
- Requests tab (pending bookings)
- Accept (auto-declines conflicts) / Decline / Cancel
- Start Walk / Stop Walk (GPS tracking)
- Mark as Complete → notifies owner to review

---

## Messaging
- 1-to-1 chat, auto-created on booking confirmation
- Send text and images (PNG/JPEG ≤2 MB)
- Unread badge, online presence indicator
- Delete own sent messages (shown as "Message deleted" to both)
- Find Minders → Message button works

---

## Notifications
- Booking request, confirmed, declined, cancelled, auto-declined
- Walk complete → leave a review prompt
- Service application received (admin)
- Service approved / rejected (minder)
- Dispute outcome (reporter)
- 24hr booking reminder
- `dispute_outcome` and `service_update` auto-deleted 14 days after read

---

## Reviews
- Owners leave star rating (1–5) + text after completed booking
- Minder profile shows average rating, count, and all reviews
- Reviewer can delete their own review (🗑)
- Profile → Reviews → Reviews I've Given: shows written reviews + write new
- Reviews I've Received (minders): shows all incoming reviews

---

## GPS Walk Tracking
- Minder: Start/Stop Walk → pushes coordinates to backend
- Owner: View Live Location → Leaflet map, polls every 5s, 🐾 marker

---

## Admin Panel

### Users tab
- View all accounts with role/status
- Orange dot on avatar = pending services or uploaded qualifications
- Edit name / email / role
- Suspend / Unsuspend (blocks all requests immediately)
- Remove account

### Minder detail panel
- Shows all services minder has access to (basic + admin-enabled)
- Pending service applications → click to dismiss
- Enable/disable advanced services via toggles → notifies minder
- Uploaded qualifications collapsible → expand images, × delete each
- Reviews Written collapsible → each review with 🗑 delete

### Disputes tab
- View open disputes
- Resolve / Dismiss → sends `⚖️` notification to reporter

---

## Report System
- Report any user from their profile
- Categories: Inappropriate behaviour, Harassment, Scam, Unsafe pet care, No-show, Other
- Creates dispute in Admin Disputes tab

---

## Security
- bcrypt password hashing
- JWT on all protected routes
- Role enforcement on every route
- Suspended check on every request (not just login)
