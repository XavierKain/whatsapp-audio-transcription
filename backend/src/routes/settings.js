const express = require('express');
const { requireAuth } = require('../middleware/auth');
const supabase = require('../db/supabase');

const router = express.Router();

// GET /settings — return user settings
router.get('/', requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from('user_settings')
    .select('*')
    .eq('user_id', req.userId)
    .single();

  if (error || !data) {
    return res.status(404).json({ error: 'Settings not found' });
  }

  return res.json(data);
});

// PUT /settings — update user settings
router.put('/', requireAuth, async (req, res) => {
  const { preferredLanguages, notificationsEnabled } = req.body;

  const updates = { updated_at: new Date().toISOString() };
  if (preferredLanguages !== undefined) {
    if (!Array.isArray(preferredLanguages)) {
      return res.status(400).json({ error: 'preferredLanguages must be an array' });
    }
    updates.preferred_languages = preferredLanguages;
  }
  if (notificationsEnabled !== undefined) {
    updates.notifications_enabled = notificationsEnabled;
  }

  const { data, error } = await supabase
    .from('user_settings')
    .update(updates)
    .eq('user_id', req.userId)
    .select()
    .single();

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  return res.json(data);
});

module.exports = router;
