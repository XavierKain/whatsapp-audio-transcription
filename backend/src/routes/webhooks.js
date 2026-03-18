const express = require('express');
const { verifyWebhookSignature } = require('../services/stripe');
const supabase = require('../db/supabase');

const router = express.Router();

function getAddonMinutes(priceId) {
  const map = {
    [process.env.STRIPE_PRICE_ADDON_100 || 'price_addon_100_placeholder']: 100,
    [process.env.STRIPE_PRICE_ADDON_300 || 'price_addon_300_placeholder']: 300,
    [process.env.STRIPE_PRICE_ADDON_UNLIMITED || 'price_addon_unlimited_placeholder']: 99999,
  };
  return map[priceId] || 0;
}

// POST /webhooks/stripe — raw body required for signature verification
router.post('/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  const signature = req.headers['stripe-signature'];

  let event;
  try {
    event = verifyWebhookSignature(req.body, signature);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).json({ error: 'Invalid signature' });
  }

  const { type, data } = event;
  const session = data.object;
  const userId = session.metadata?.userId;

  if (!userId) {
    return res.json({ received: true });
  }

  try {
    switch (type) {
      case 'checkout.session.completed': {
        if (session.mode === 'subscription') {
          // Subscription plan upgrade
          // Check early adopter count
          const { count } = await supabase
            .from('subscriptions')
            .select('*', { count: 'exact', head: true })
            .eq('is_early_adopter', true);

          const isEarlyAdopter = (count || 0) < 500;
          const expiresAt = new Date();
          expiresAt.setFullYear(expiresAt.getFullYear() + 1);

          await supabase
            .from('subscriptions')
            .update({
              plan: 'starter',
              status: 'active',
              stripe_subscription_id: session.subscription,
              is_early_adopter: isEarlyAdopter,
              expires_at: expiresAt.toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq('user_id', userId);
        }

        if (session.mode === 'payment') {
          // Add-on purchase
          const lineItems = session.line_items?.data || [];
          const priceId = lineItems[0]?.price?.id || '';

          const additionalMinutes = getAddonMinutes(priceId);
          if (additionalMinutes > 0) {
            const { data: sub } = await supabase
              .from('subscriptions')
              .select('extra_minutes_per_month')
              .eq('user_id', userId)
              .single();

            const newExtra = (sub?.extra_minutes_per_month || 0) + additionalMinutes;
            const addonExpiresAt = new Date();
            addonExpiresAt.setFullYear(addonExpiresAt.getFullYear() + 1);

            await supabase
              .from('subscriptions')
              .update({
                extra_minutes_per_month: newExtra,
                addon_expires_at: addonExpiresAt.toISOString(),
                updated_at: new Date().toISOString(),
              })
              .eq('user_id', userId);
          }
        }
        break;
      }

      case 'invoice.paid': {
        // Subscription renewal — reset add-ons
        await supabase
          .from('subscriptions')
          .update({
            status: 'active',
            extra_minutes_per_month: 0,
            addon_expires_at: null,
            updated_at: new Date().toISOString(),
          })
          .eq('stripe_subscription_id', session.subscription);
        break;
      }

      case 'customer.subscription.deleted': {
        await supabase
          .from('subscriptions')
          .update({
            plan: 'free',
            status: 'cancelled',
            stripe_subscription_id: null,
            extra_minutes_per_month: 0,
            addon_expires_at: null,
            updated_at: new Date().toISOString(),
          })
          .eq('stripe_subscription_id', session.id);
        break;
      }
    }
  } catch (err) {
    console.error('Webhook processing error:', err.message);
  }

  res.json({ received: true });
});

module.exports = router;
