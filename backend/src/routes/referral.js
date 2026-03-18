const express = require('express');
const { requireAuth } = require('../middleware/auth');
const supabase = require('../db/supabase');

const router = express.Router();

// GET /referral/code — return user's referral code
router.get('/code', requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from('users')
    .select('referral_code')
    .eq('id', req.userId)
    .single();

  if (error || !data) {
    return res.status(404).json({ error: 'User not found' });
  }

  return res.json({ referralCode: data.referral_code });
});

module.exports = router;
