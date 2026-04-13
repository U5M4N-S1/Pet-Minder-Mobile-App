const express = require('express');
const db      = require('../db');
const { requireAuth } = require('../middleware/authMiddleware');

const router = express.Router();

function nextId(collection) {
  const last = db.get(collection).maxBy('id').value();
  return last ? last.id + 1 : 1;
}

// Find (or create) a 1-on-1 chat between two user ids. Exposed so that
// bookings.js can call it when a minder accepts a booking.
function findOrCreateChat(userAId, userBId) {
  const a = Number(userAId);
  const b = Number(userBId);
  if (!a || !b || a === b) return null;
  const existing = db.get('chats')
    .find(c => (c.userA === a && c.userB === b) || (c.userA === b && c.userB === a))
    .value();
  if (existing) return existing;
  const chat = {
    id:            nextId('chats'),
    userA:         a,
    userB:         b,
    createdAt:     new Date().toISOString(),
    lastMessageAt: new Date().toISOString(),
    lastPreview:   ''
  };
  db.get('chats').push(chat).write();
  return chat;
}

// A user is "online" only when both their online flag is true AND their
// last heartbeat (lastSeenAt, refreshed on every /auth/me call) is within
// the presence window. This way a user who closes the tab without hitting
// logout falls back to offline on their own.
const PRESENCE_WINDOW_MS = 2 * 60 * 1000;
function isOnline(u) {
  if (!u || !u.online) return false;
  if (!u.lastSeenAt) return false;
  return (Date.now() - new Date(u.lastSeenAt).getTime()) < PRESENCE_WINDOW_MS;
}

function otherUserDTO(u) {
  if (!u) return { id: null, name: 'Unknown', avatar: '', online: false };
  return {
    id:     u.id,
    name:   ((u.firstName || '') + ' ' + (u.lastName || '')).trim() || u.email || 'User',
    avatar: u.profileImage || '',
    online: isOnline(u)
  };
}

// GET /api/chats — list chats for the logged-in user, newest-message first
router.get('/', requireAuth, (req, res) => {
  const me = req.user.userId;
  const mine = db.get('chats')
    .filter(c => c.userA === me || c.userB === me)
    .value()
    .slice()
    .sort((x, y) => new Date(y.lastMessageAt || 0) - new Date(x.lastMessageAt || 0));

  const withOther = mine.map(c => {
    const otherId = c.userA === me ? c.userB : c.userA;
    const otherUser = db.get('users').find({ id: otherId }).value();
    const unread = db.get('messages')
      .filter({ chatId: c.id })
      .filter(m => m.fromUserId !== me && !m.read)
      .size()
      .value();
    return {
      id:            c.id,
      other:         otherUserDTO(otherUser),
      lastMessageAt: c.lastMessageAt,
      lastPreview:   c.lastPreview || '',
      unread
    };
  });
  res.json(withOther);
});

// GET /api/chats/:id/messages — messages for a chat (requester must be a member)
router.get('/:id/messages', requireAuth, (req, res) => {
  const me      = req.user.userId;
  const chatId  = Number(req.params.id);
  const chat    = db.get('chats').find({ id: chatId }).value();
  if (!chat) return res.status(404).json({ error: 'Chat not found' });
  if (chat.userA !== me && chat.userB !== me) return res.status(403).json({ error: 'Not your chat' });

  // Mark incoming messages as read
  db.get('messages')
    .filter({ chatId })
    .filter(m => m.fromUserId !== me && !m.read)
    .each(m => { m.read = true; })
    .write();

  const list = db.get('messages')
    .filter({ chatId })
    .sortBy('createdAt')
    .value();
  res.json(list);
});

// POST /api/chats/:id/messages — send a message in a chat
// Body: { text } for text messages, { image } for image messages (data-URI)
router.post('/:id/messages', requireAuth, express.json({ limit: '3mb' }), (req, res) => {
  const me     = req.user.userId;
  const chatId = Number(req.params.id);
  const text   = String((req.body && req.body.text) || '').trim();
  const image  = (req.body && req.body.image) || '';

  if (!text && !image) return res.status(400).json({ error: 'Message text or image is required' });

  // Validate image if provided
  if (image) {
    if (typeof image !== 'string' || !image.match(/^data:image\/(jpeg|png|webp|gif);base64,/)) {
      return res.status(400).json({ error: 'Invalid image format' });
    }
    if (image.length > 2 * 1024 * 1024) {
      return res.status(400).json({ error: 'Image too large. Maximum 2 MB' });
    }
  }

  const chatRow = db.get('chats').find({ id: chatId });
  const chat    = chatRow.value();
  if (!chat) return res.status(404).json({ error: 'Chat not found' });
  if (chat.userA !== me && chat.userB !== me) return res.status(403).json({ error: 'Not your chat' });

  const now = new Date().toISOString();
  const msg = {
    id:         nextId('messages'),
    chatId,
    fromUserId: me,
    text:       text || '',
    read:       false,
    createdAt:  now
  };
  if (image) msg.image = image;
  db.get('messages').push(msg).write();

  const preview = image ? (text || '📷 Photo') : text.slice(0, 80);
  chatRow.assign({ lastMessageAt: now, lastPreview: preview }).write();

  res.status(201).json(msg);
});

// POST /api/chats — explicit create/find (used by booking acceptance and by
// the Message button on a minder profile). Body: { otherUserId }
router.post('/', requireAuth, (req, res) => {
  const otherId = Number(req.body && req.body.otherUserId);
  if (!otherId) return res.status(400).json({ error: 'otherUserId is required' });
  const chat = findOrCreateChat(req.user.userId, otherId);
  if (!chat) return res.status(400).json({ error: 'Cannot create chat' });
  res.status(201).json(chat);
});

module.exports         = router;
module.exports.findOrCreateChat = findOrCreateChat;
