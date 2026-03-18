const express = require('express');
const { requireAuth } = require('../middleware/auth');
const supabase = require('../db/supabase');

const router = express.Router();

// POST /push/register — upsert a push token for the authenticated user
router.post('/register', requireAuth, async (req, res) => {
  const { token, platform } = req.body;
  if (!token) {
    return res.status(400).json({ error: 'token is required' });
  }

  const { error } = await supabase.from('push_tokens').upsert(
    {
      user_id: req.userId,
      expo_push_token: token,
      platform: platform || null,
    },
    { onConflict: 'user_id,platform' }
  );

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  return res.json({ success: true });
});

module.exports = router;
