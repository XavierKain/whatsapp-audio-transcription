const express = require('express');
const supabase = require('../db/supabase');
const { createCustomer } = require('../services/stripe');

const router = express.Router();

function generateReferralCode(email) {
  const prefix = email.slice(0, 4).toUpperCase().replace(/[^A-Z0-9]/g, 'X');
  const suffix = Math.random().toString(16).slice(2, 6).toUpperCase();
  return `${prefix}-${suffix}`;
}

const BONUS_MINUTES = 30;

// POST /auth/signup
router.post('/signup', async (req, res) => {
  const { email, password, referralCode } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'email and password are required' });
  }

  // Create Supabase Auth user
  const { data: authData, error: signUpError } = await supabase.auth.signUp({ email, password });
  if (signUpError) {
    return res.status(400).json({ error: signUpError.message });
  }

  const userId = authData.user.id;
  const referral_code = generateReferralCode(email);

  // Look up referrer before inserting user
  let referrerUserId = null;
  if (referralCode) {
    const { data: referrer } = await supabase
      .from('users')
      .select('id')
      .eq('referral_code', referralCode)
      .single();
    if (referrer) {
      referrerUserId = referrer.id;
    }
  }

  // Insert into users table
  const { error: userError } = await supabase.from('users').insert({
    id: userId,
    email,
    referral_code,
    referred_by_user_id: referrerUserId,
  });
  if (userError) {
    return res.status(500).json({ error: userError.message });
  }

  // Create Stripe customer (optional — gracefully handles missing key)
  const stripeCustomerId = await createCustomer(email).catch(() => null);

  // Insert default subscription
  const { error: subError } = await supabase.from('subscriptions').insert({
    user_id: userId,
    plan: 'free',
    status: 'active',
    stripe_customer_id: stripeCustomerId,
  });
  if (subError) {
    return res.status(500).json({ error: subError.message });
  }

  // Insert default user_settings
  const { error: settingsError } = await supabase.from('user_settings').insert({
    user_id: userId,
  });
  if (settingsError) {
    return res.status(500).json({ error: settingsError.message });
  }

  // Handle referral: create referral row and add bonus minutes to both users
  if (referrerUserId) {
    await supabase.from('referrals').insert({
      referrer_user_id: referrerUserId,
      referred_user_id: userId,
      bonus_applied_at: new Date().toISOString(),
    });

    // Add bonus to new user
    await supabase.rpc('increment_bonus_minutes', {
      p_user_id: userId,
      p_minutes: BONUS_MINUTES,
    }).catch(() => {
      // If RPC not available, do a direct update
      supabase
        .from('subscriptions')
        .update({ bonus_minutes: BONUS_MINUTES })
        .eq('user_id', userId);
    });

    // Add bonus to referrer
    const { data: referrerSub } = await supabase
      .from('subscriptions')
      .select('bonus_minutes')
      .eq('user_id', referrerUserId)
      .single();

    if (referrerSub) {
      await supabase
        .from('subscriptions')
        .update({ bonus_minutes: (referrerSub.bonus_minutes || 0) + BONUS_MINUTES })
        .eq('user_id', referrerUserId);
    }
  }

  return res.status(201).json({
    session: authData.session,
    user: { id: userId, email, referral_code },
  });
});

// POST /auth/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'email and password are required' });
  }

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    return res.status(401).json({ error: error.message });
  }

  return res.json({ session: data.session, user: data.user });
});

module.exports = router;
