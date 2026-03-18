const Stripe = require('stripe');
const config = require('../config');

// Initialize with optional key (may not be set in dev)
const stripe = config.stripeSecretKey ? new Stripe(config.stripeSecretKey) : null;

// Price IDs (set in Stripe Dashboard)
const PRICES = {
  starter_annual: process.env.STRIPE_PRICE_STARTER_ANNUAL || 'price_starter_placeholder',
  addon_100: process.env.STRIPE_PRICE_ADDON_100 || 'price_addon_100_placeholder',
  addon_300: process.env.STRIPE_PRICE_ADDON_300 || 'price_addon_300_placeholder',
  addon_unlimited: process.env.STRIPE_PRICE_ADDON_UNLIMITED || 'price_addon_unlimited_placeholder',
};

/**
 * Create a Stripe customer for a new user.
 */
async function createCustomer(email) {
  if (!stripe) return null;
  const customer = await stripe.customers.create({ email });
  return customer.id;
}

/**
 * Create a Stripe Checkout Session for subscription upgrade.
 */
async function createCheckoutSession(customerId, priceId, userId, mode = 'subscription') {
  if (!stripe) throw new Error('Stripe not configured');

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    payment_method_types: ['card'],
    line_items: [{ price: priceId, quantity: 1 }],
    mode,
    success_url: `${config.appUrl || 'voicescribe://'}payment-success`,
    cancel_url: `${config.appUrl || 'voicescribe://'}payment-cancel`,
    metadata: { userId },
  });

  return { sessionId: session.id, url: session.url };
}

/**
 * Verify Stripe webhook signature.
 */
function verifyWebhookSignature(payload, signature) {
  if (!stripe) throw new Error('Stripe not configured');
  return stripe.webhooks.constructEvent(
    payload,
    signature,
    config.stripeWebhookSecret
  );
}

module.exports = { createCustomer, createCheckoutSession, verifyWebhookSignature, PRICES, stripe };
