const express = require('express');
const { requireAuth } = require('../middleware/auth');

// In-memory rate-limit map: userId -> timestamp of last pair request
const pairCooldowns = new Map();
const PAIR_COOLDOWN_MS = 90 * 1000; // 90 seconds

function createWhatsAppRouter(sessionManager) {
  const router = express.Router();

  // POST /whatsapp/pair — request a pairing code
  router.post('/pair', requireAuth, async (req, res) => {
    const { phoneNumber } = req.body;
    if (!phoneNumber) {
      return res.status(400).json({ error: 'phoneNumber is required' });
    }

    const userId = req.userId;
    const lastPair = pairCooldowns.get(userId);
    if (lastPair && Date.now() - lastPair < PAIR_COOLDOWN_MS) {
      const remainingSec = Math.ceil((PAIR_COOLDOWN_MS - (Date.now() - lastPair)) / 1000);
      return res.status(429).json({
        error: `Rate limited. Try again in ${remainingSec}s`,
      });
    }

    try {
      // Baileys expects phone number without '+' and without spaces
      const cleanNumber = phoneNumber.replace(/[^0-9]/g, '');
      console.log(`[PAIR] Requesting code for user ${userId}, phone: ${cleanNumber}`);
      const code = await sessionManager.requestPairingCode(userId, cleanNumber);
      console.log(`[PAIR] Got code: ${code}`);
      pairCooldowns.set(userId, Date.now());
      return res.json({ code });
    } catch (err) {
      console.error(`[PAIR] Error:`, err);
      return res.status(500).json({ error: err.message });
    }
  });

  // GET /whatsapp/status — get current session status
  router.get('/status', requireAuth, (req, res) => {
    const status = sessionManager.getStatus(req.userId);
    return res.json({ status });
  });

  // DELETE /whatsapp/disconnect — stop the session
  router.delete('/disconnect', requireAuth, async (req, res) => {
    try {
      await sessionManager.stopSession(req.userId);
      return res.json({ success: true });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  return router;
}

module.exports = { createWhatsAppRouter };
