# PawPal – Full Feature List
> From a user perspective across all roles: Owner, Minder, and Admin.

---

## 🔐 Authentication & Accounts

- Register as a **Pet Owner**, **Pet Minder**, or both roles simultaneously
- Login with email and password
- Forgot password — generates a 6-digit code (expires after 10 minutes), reset via email + code
- Passwords hashed with **bcrypt** — never stored in plain text
- Log out from profile menu
- **JWT tokens** used for all API requests — session expires after 7 days
- Suspended users blocked **at login** and on **every API request** (existing tokens immediately rejected)
- All protected routes require authentication — unauthenticated requests return 401

---

## 👤 Profile Management

- View and edit: first name, last name, email, bio, location
- Upload and remove a **profile picture** (base64, validated for size and format)
- Minders set their **service area**, **experience**, and **certifications** (text)
- Minders set a **price range** (min/max per hour)
- Minders set **per-day availability** — morning / afternoon / evening slots per day of the week
- Minders toggle their overall **availability on/off** — toggled-off minders are hidden from search entirely
- Owners can use the **"Become a Minder"** flow to add minder services without re-registering
- Minders can **apply for additional services** (Grooming, Vet, Training) — goes to admin for approval
- Minders can **upload a qualification image** (PNG, max 3 MB) alongside a service application — stored on their profile and visible to admins

---

## 🐕 Pet Management (Owners)

- Add, edit, and remove pets
- Per-pet fields: name, breed, age, emoji icon
- Medical notes and special care instructions
- Pets persist across sessions and appear in the booking flow for selection

---

## 🔍 Find a Minder (Owners)

- Search minders by **location or postcode** (text match against minder's service area)
- **Quick-sort chip bar** directly on the search page — one tap to sort by:
  - 📍 Nearest first (real GPS + Nominatim geocoding, shows "X km away" badge on each card)
  - ⭐ Top Rated
  - 💬 Most Reviews
  - 💰 Price low → high
  - 💰 Price high → low
- Tap again to **toggle sort off**; chips stay in sync with the filter modal
- **Filter modal** (🎛 Filters button) combines all filters at once:
  - Pet type (Dogs, Cats, Small Pets, Birds)
  - Service type (Walking, Home Visit, Grooming, Vet, Training)
  - Minimum star rating (1★ – 5★)
  - Price range (£min – £max per hour)
  - Sort By (same 5 options as chips)
- The **logged-in minder** does not appear in their own search results — shows "Your listing" label instead of Book Now
- **Suspended minders** are excluded from results entirely
- Minders who have **toggled availability off** are excluded from results
- Minders with no services set are excluded from results

---

## 🧑‍🦱 Minder Profile Page

- Full profile: name, bio, location, services, pets cared for, experience, certifications
- Price range displayed
- Per-day availability schedule shown
- Star rating average + review count
- All written reviews listed with star rating, reviewer name, and date
- **Book Now** button (owners only, not your own profile)
- **💬 Message** button — opens or creates a chat
- **🚩 Report** button — owners can report a minder

---

## 📅 Booking a Service (Owners)

- Select a **service** from the minder's offered services (Dog Walking, Home Visit, Grooming)
- Choose a **date** from a rolling calendar (next 14 days)
- Choose a **time slot** — slots are greyed out when:
  - The minder already has a confirmed booking at that time
  - The minder's availability schedule excludes that day/time
  - One of your selected pets already has a booking at that time
- Select **one or more pets** — multi-pet adds £5 per extra pet automatically
- **Live booking summary** updates in real time (service, date/time, pet list, total cost)
- **Cannot book yourself** as a minder — error shown if attempted
- Client-side conflict pre-check before submission for faster feedback
- Server-side double-booking prevention (same-pet and same-minder-confirmed conflicts)

---

## 📬 Booking Management

**Owners can:**
- View **Upcoming** bookings (pending + confirmed)
- View **Past** bookings (completed, cancelled, declined)
- Open booking detail — date, time, service, pet, minder, price, status
- **Cancel** a pending or confirmed booking
- **📍 View Live Location** on confirmed bookings

**Minders can:**
- View a dedicated **Requests tab** with all pending bookings
- **Accept** a booking — auto-declines competing requests for the same slot and notifies those owners
- **Decline** a booking — owner is notified
- **Cancel** an accepted booking — owner is notified
- **🟢 Start Walk / ⏹ Stop Walk** toggle on confirmed bookings
- **✅ Mark as Complete** — transitions to `completed`, notifies owner to leave a review

---

## 📍 GPS Walk Tracking

**Minder side:**
- **Start Walk** button uses `watchPosition` for continuous GPS updates, pushed to the backend on every move
- **Stop Walk** halts tracking; button highlights orange while active
- Tracking automatically stops when a booking is marked complete

**Owner side:**
- **📍 View Live Location** button on confirmed bookings
- Opens a bottom-sheet modal with a real **Leaflet / OpenStreetMap** map
- Polls every 5 seconds — moves a 🐾 marker to the minder's current position
- Shows "● Live · Updated HH:MM:SS" or "Waiting for minder to start walk…"

---

## 💬 Messaging

- 1-to-1 chat between any owner and minder
- Chat auto-created when a booking is confirmed
- Full message history stored and persisted
- Unread message badge on the Messages nav item
- **Online presence indicator** — green/grey dot in chat list
- Send with Enter key or send button
- **📷 Send images** — tap the camera button to pick a PNG/JPEG (max 2 MB); displays inline with tap-to-fullscreen preview

**Users can:**
- **Delete their own sent messages** — hover over a sent bubble to reveal ×; marks as deleted for both parties (shows "Message deleted" in grey italic)
- **Delete a conversation** — tap 🗑 in the chat header; hides it from your list only, the other person's view is unaffected

---

## 🔔 Notifications

Notification bell with unread badge. Notifications for:
- Booking request received (minder)
- Booking confirmed / declined (owner)
- Booking cancelled by carer (owner)
- Competing booking auto-declined (owner)
- Walk complete — leave a review (owner)
- Service application received (admin)
- Service approved / rejected (minder)
- Booking reminder 24 hours before (both)

Notifications are read-on-open, individually deletable, and tap-to-navigate.

---

## ⭐ Reviews

- Owners leave a **star rating (1–5)** and **written review** for a minder
- Cannot review yourself — server-side check
- Only owners can submit reviews
- Average rating and count shown on search cards and minder profile

---

## 📜 Qualification Images (Minders)

- Upload a **PNG qualification image** (max 3 MB) when applying for advanced services
- File type enforced client-side (`accept="image/png"`) and server-side (MIME validation)
- Stored as base64 on the minder's account (up to 10 images)
- Admins can view and delete qualification images from the user detail panel

---

## 🛡 Admin Panel

### 👥 Users Tab
- View all registered accounts
- Click any user card to open a **slide-in detail panel**
- **Edit** name, email, role
- **Suspend / Unsuspend** — immediately blocks or restores login and all API access
- **Remove** — permanently deletes account, pets, and bookings

**Minder detail panel also shows:**
- Current services (basic + admin-enabled)
- Pending service applications (highlighted amber)
- **Enable/disable advanced services** via toggles — notifies minder instantly
- **📎 Uploaded Qualifications** — collapsible image grid; each image has a **×** delete button; tap to fullscreen

### ⚠️ Disputes Tab
- View all open disputes filed via the report system
- Resolve or dismiss each dispute

### 💬 Chats Tab
- Lists every conversation — participant names, message count, last preview
- **🗑 Delete** button per row — hard-deletes the entire chat and all messages
- Click a chat to open it and view all messages with timestamps
- **×** button per message to hard-delete that individual message
- **🗑 Delete chat** button also available inside the open conversation
- Inline image messages viewable with tap-to-fullscreen

---

## 🚩 Report System

- Report any user from their profile or booking detail
- Categories: Inappropriate behaviour, Harassment, Scam, Unsafe pet care, No-show, Other
- Creates a dispute record in the Admin Disputes tab
- Admins resolve or dismiss disputes

---

## 🔒 Security & Access Control

- bcrypt password hashing
- JWT on every protected route
- Role enforcement — owners book, minders accept/complete, admins manage
- Suspended users blocked at middleware level regardless of token validity
- Users can only delete their own sent messages
- Chat routes restricted to participants; admin routes require admin role
- GPS location endpoint restricted to the booking's two parties
- Qualification upload/delete restricted to owner (minder) or admin

---

## 🧱 Non-Functional

- Mobile-first responsive design — works on iOS and Android browsers
- iOS input zoom prevented (font-size: 16px enforced)
- Fixed messages layout — input bar always visible, chat scrolls internally
- Structured error messages on all API responses
- Booking conflict checks run client-side and server-side
- Availability enforced at booking creation — slots outside schedule blocked
