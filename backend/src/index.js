const express = require('express');
const config = require('./config');
const { SessionManager } = require('./sessions/sessionManager');
const { processAudioMessage } = require('./pipeline/transcribe');
const { startRetryWorker, stopRetryWorker } = require('./pipeline/retryWorker');
const { createWhatsAppRouter } = require('./routes/whatsapp');
const pushRouter = require('./routes/push');
const authRouter = require('./routes/auth');
const transcriptionsRouter = require('./routes/transcriptions');
const usageRouter = require('./routes/usage');
const settingsRouter = require('./routes/settings');
const subscriptionRouter = require('./routes/subscription');
const referralRouter = require('./routes/referral');
const webhooksRouter = require('./routes/webhooks');

const cors = require('cors');
const app = express();

app.use(cors());

// Mount webhooks BEFORE express.json() — Stripe requires raw body for signature verification
app.use('/webhooks', webhooksRouter);

app.use(express.json());

const sessionManager = new SessionManager();

sessionManager.emitter.on('audio-received', ({ userId, message }) => {
  processAudioMessage(userId, message).catch((err) => {
    console.error(`Pipeline error for ${userId}:`, err.message);
  });
});

app.use('/whatsapp', createWhatsAppRouter(sessionManager));
app.use('/push', pushRouter);
app.use('/auth', authRouter);
app.use('/transcriptions', transcriptionsRouter);
app.use('/usage', usageRouter);
app.use('/settings', settingsRouter);
app.use('/subscription', subscriptionRouter);
app.use('/referral', referralRouter);

app.get('/health', (req, res) => {
  res.json({ status: 'ok', sessions: sessionManager.sessions.size });
});

const server = app.listen(config.port, '0.0.0.0', async () => {
  console.log(`VoiceScribe backend running on port ${config.port}`);
  await sessionManager.restoreAllSessions();
  startRetryWorker();
});

const shutdown = () => {
  console.log('Shutting down...');
  stopRetryWorker();
  sessionManager.shutdown();
  server.close(() => process.exit(0));
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

module.exports = app;
