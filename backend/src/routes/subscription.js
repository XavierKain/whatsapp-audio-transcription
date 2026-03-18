const express = require('express');
const { requireAuth } = require('../middleware/auth');
const supabase = require('../db/supabase');

const router = express.Router();

// GET /subscription — return current plan + extras + is_early_adopter
router.get('/', requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from('subscriptions')
    .select(
      'plan, status, expires_at, extra_minutes_per_month, addon_expires_at, bonus_minutes, is_early_adopter'
    )
    .eq('user_id', req.userId)
    .single();

  if (error || !data) {
    return res.status(404).json({ error: 'Subscription not found' });
  }

  return res.json(data);
});

// POST /subscription/upgrade — placeholder until Stripe is integrated (Phase 4)
router.post('/upgrade', requireAuth, async (req, res) => {
  const { plan, addon } = req.body;

  if (!plan && !addon) {
    return res.status(400).json({ error: 'plan or addon is required' });
  }

  return res.status(501).json({
    message: 'Stripe checkout not yet implemented',
    plan: plan || addon,
  });
});

module.exports = router;
