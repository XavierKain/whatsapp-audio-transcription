const dotenv = require('dotenv');
dotenv.config();

const required = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_KEY',
  'GROQ_API_KEY',
  'ENCRYPTION_KEY',
];

for (const key of required) {
  if (!process.env[key]) {
    throw new Error(`Missing required env var: ${key}`);
  }
}

module.exports = {
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseServiceKey: process.env.SUPABASE_SERVICE_KEY,
  groqApiKey: process.env.GROQ_API_KEY,
  encryptionKey: process.env.ENCRYPTION_KEY,
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  stripeSecretKey: process.env.STRIPE_SECRET_KEY || '',
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
  appUrl: process.env.APP_URL || '',
};
