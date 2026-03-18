const express = require('express');
const { requireAuth } = require('../middleware/auth');
const supabase = require('../db/supabase');
const { createCheckoutSession, createCustomer, PRICES } = require('../services/stripe');

const router = express.Router();

// GET /subscription — return current plan + extras + is_early_adopter
router.get('/', requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from('subscriptions')
    .select('*')
    .eq('user_id', req.userId)
    .single();

  if (error || !data) {
    return res.status(404).json({ error: 'Subscription not found' });
  }

  res.json(data);
});

// POST /subscription/upgrade — create Stripe checkout session
router.post('/upgrade', requireAuth, async (req, res) => {
  const { plan, addon } = req.body;

  // Get user's subscription
  const { data: sub } = await supabase
    .from('subscriptions')
    .select('*')
    .eq('user_id', req.userId)
    .single();

  if (!sub) {
    return res.status(404).json({ error: 'Subscription not found' });
  }

  let priceId;
  let mode = 'subscription';

  if (plan === 'starter') {
    priceId = PRICES.starter_annual;
    mode = 'subscription';
  } else if (addon === '+100') {
    priceId = PRICES.addon_100;
    mode = 'payment';
  } else if (addon === '+300') {
    priceId = PRICES.addon_300;
    mode = 'payment';
  } else if (addon === 'unlimited') {
    priceId = PRICES.addon_unlimited;
    mode = 'payment';
  } else {
    return res.status(400).json({ error: 'Invalid plan or addon' });
  }

  // Create Stripe customer if not exists
  if (!sub.stripe_customer_id) {
    const { data: user } = await supabase
      .from('users')
      .select('email')
      .eq('id', req.userId)
      .single();

    const customerId = await createCustomer(user.email).catch(() => null);
    if (customerId) {
      await supabase
        .from('subscriptions')
        .update({ stripe_customer_id: customerId })
        .eq('user_id', req.userId);
      sub.stripe_customer_id = customerId;
    }
  }

  try {
    const { url } = await createCheckoutSession(
      sub.stripe_customer_id,
      priceId,
      req.userId,
      mode
    );
    res.json({ url });
  } catch (err) {
    if (err.message === 'Stripe not configured') {
      return res.status(501).json({ message: 'Stripe not yet configured. Set STRIPE_SECRET_KEY.' });
    }
    res.status(500).json({ error: 'Failed to create checkout session' });
  }
});

module.exports = router;
