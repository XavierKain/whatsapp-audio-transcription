const express = require('express');
const { requireAuth } = require('../middleware/auth');
const supabase = require('../db/supabase');

const router = express.Router();

const PLAN_BASE_MINUTES = {
  free: 30,
  starter: 120,
  pro: 300,
  unlimited: Infinity,
};

// GET /usage/current
router.get('/current', requireAuth, async (req, res) => {
  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  // Fetch subscription
  const { data: sub, error: subError } = await supabase
    .from('subscriptions')
    .select('plan, extra_minutes_per_month, addon_expires_at, bonus_minutes')
    .eq('user_id', req.userId)
    .single();

  if (subError) {
    return res.status(500).json({ error: subError.message });
  }

  const plan = sub?.plan || 'free';
  const baseMinutes = PLAN_BASE_MINUTES[plan] ?? PLAN_BASE_MINUTES.free;

  // Addon minutes (only if not expired)
  let addonMinutes = 0;
  if (sub?.extra_minutes_per_month > 0) {
    const addonExpiry = sub.addon_expires_at ? new Date(sub.addon_expires_at) : null;
    if (!addonExpiry || addonExpiry > now) {
      addonMinutes = sub.extra_minutes_per_month;
    }
  }

  const bonusMinutes = sub?.bonus_minutes || 0;
  const minutesLimit = baseMinutes === Infinity
    ? Infinity
    : baseMinutes + addonMinutes + bonusMinutes;

  // Fetch usage for current month
  const { data: usageRow } = await supabase
    .from('usage')
    .select('minutes_used')
    .eq('user_id', req.userId)
    .eq('month', month)
    .single();

  const minutesUsed = usageRow?.minutes_used || 0;

  // Count hidden transcriptions this month
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const { count: hiddenTranscriptions } = await supabase
    .from('transcriptions')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', req.userId)
    .eq('visible', false)
    .gte('created_at', startOfMonth);

  // Reset date = first day of next month
  const resetDate = new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString();

  return res.json({
    minutesUsed,
    minutesLimit: minutesLimit === Infinity ? null : minutesLimit,
    resetDate,
    hiddenTranscriptions: hiddenTranscriptions || 0,
  });
});

module.exports = router;
