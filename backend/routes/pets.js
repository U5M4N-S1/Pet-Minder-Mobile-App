const express = require('express');
const db      = require('../db');
const { requireAuth } = require('../middleware/authMiddleware');

const router = express.Router();

const PET_EMOJIS = { Dog: '🐕', Cat: '🐈', Rabbit: '🐇', Bird: '🐦', Other: '🐾' };

function nextId() {
  const last = db.get('pets').maxBy('id').value();
  return last ? last.id + 1 : 1;
}

function toDTO(p) {
  return {
    id:      p.id,
    name:    p.name,
    type:    p.type,
    breed:   p.breed,
    age:     p.age,
    medical: p.medical,
    care:    p.care,
    emoji:   p.emoji
  };
}

function sanitise(body) {
  const name = (body.name || '').trim();
  if (!name) return { error: 'Pet name is required' };
  const type = (body.type || 'Other').trim();
  return {
    value: {
      name,
      type,
      breed:   (body.breed   || '').trim(),
      age:     (body.age     || '').trim(),
      medical: (body.medical || '').trim(),
      care:    (body.care    || '').trim(),
      emoji:   body.emoji || PET_EMOJIS[type] || '🐾'
    }
  };
}

// GET /api/pets — list the logged-in user's pets
router.get('/', requireAuth, (req, res) => {
  const pets = db.get('pets')
    .filter({ ownerId: req.user.userId })
    .sortBy('id')
    .value();
  res.json(pets.map(toDTO));
});

// POST /api/pets — create a new pet for the logged-in user
router.post('/', requireAuth, (req, res) => {
  const { error, value } = sanitise(req.body);
  if (error) return res.status(400).json({ error });

  const pet = {
    id:        nextId(),
    ownerId:   req.user.userId,
    ...value,
    createdAt: new Date().toISOString()
  };
  db.get('pets').push(pet).write();
  res.status(201).json(toDTO(pet));
});

// PATCH /api/pets/:id — update a pet the user owns
router.patch('/:id', requireAuth, (req, res) => {
  const id  = Number(req.params.id);
  const row = db.get('pets').find({ id });
  const pet = row.value();
  if (!pet) return res.status(404).json({ error: 'Pet not found' });
  if (pet.ownerId !== req.user.userId) return res.status(403).json({ error: 'Forbidden' });

  const { error, value } = sanitise(req.body);
  if (error) return res.status(400).json({ error });

  row.assign(value).write();
  res.json(toDTO(row.value()));
});

// DELETE /api/pets/:id — delete a pet the user owns
router.delete('/:id', requireAuth, (req, res) => {
  const id  = Number(req.params.id);
  const pet = db.get('pets').find({ id }).value();
  if (!pet) return res.status(404).json({ error: 'Pet not found' });
  if (pet.ownerId !== req.user.userId) return res.status(403).json({ error: 'Forbidden' });

  db.get('pets').remove({ id }).write();
  res.status(204).end();
});

module.exports = router;
