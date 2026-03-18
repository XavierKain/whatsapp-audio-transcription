'use strict';

const os = require('os');
const path = require('path');
const fs = require('fs');

const { transcribeAudio, summarizeTranscript } = require('../services/groq');
const { sendPushNotification } = require('../services/push');
const supabase = require('../db/supabase');
const config = require('../config');

// @whiskeysockets/baileys is ESM-only at the package level but ships a CJS
// build via the "main" field. We use a lazy dynamic import so the module only
// loads when an audio message is actually processed, keeping startup fast and
// making the dependency easy to mock in tests.
async function getBaileysDownloader() {
  // In the Jest test environment jest.mock() intercepts this require; in
  // production Node we use await import() for proper ESM resolution.
  if (typeof jest !== 'undefined') {
    // eslint-disable-next-line global-require
    return require('@whiskeysockets/baileys').downloadMediaMessage;
  }
  const mod = await import('@whiskeysockets/baileys');
  return mod.downloadMediaMessage;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const PLAN_LIMITS = { free: 5, starter: 100, unlimited: Infinity };
const MAX_DURATION_SEC = 600; // 10 minutes

// How long after quota exceeded before we hard-stop (soft-block buffer)
const SOFT_BLOCK_DAYS = 2;

// ─── DB Helpers ──────────────────────────────────────────────────────────────

async function getMonthlyLimit(userId) {
  const { data, error } = await supabase
    .from('subscriptions')
    .select('plan, extra_minutes_per_month, addon_expires_at, bonus_minutes')
    .eq('user_id', userId)
    .single();

  if (error || !data) {
    return PLAN_LIMITS.free;
  }

  const basePlan = data.plan || 'free';
  const baseMinutes = PLAN_LIMITS[basePlan] ?? PLAN_LIMITS.free;

  // Add-on minutes only count if addon hasn't expired
  let addonMinutes = 0;
  if (data.addon_expires_at && new Date(data.addon_expires_at) > new Date()) {
    addonMinutes = data.extra_minutes_per_month || 0;
  }

  const bonusMinutes = data.bonus_minutes || 0;

  return baseMinutes + addonMinutes + bonusMinutes;
}

async function getCurrentUsage(userId) {
  const month = new Date().toISOString().slice(0, 7); // YYYY-MM

  const { data, error } = await supabase
    .from('usage')
    .select('minutes_used, quota_exceeded_at')
    .eq('user_id', userId)
    .eq('month', month)
    .maybeSingle();

  if (error || !data) {
    return { minutes_used: 0, quota_exceeded_at: null };
  }

  return {
    minutes_used: data.minutes_used || 0,
    quota_exceeded_at: data.quota_exceeded_at || null,
  };
}

async function getPushTokens(userId) {
  const { data, error } = await supabase
    .from('push_tokens')
    .select('expo_push_token')
    .eq('user_id', userId);

  if (error || !data) return [];
  return data.map((row) => row.expo_push_token);
}

async function isNotificationsEnabled(userId) {
  const { data, error } = await supabase
    .from('user_settings')
    .select('notifications_enabled')
    .eq('user_id', userId)
    .single();

  if (error || !data) return true; // default true
  return data.notifications_enabled !== false;
}

async function notifyUser(userId, payload) {
  const enabled = await isNotificationsEnabled(userId);
  if (!enabled) return;

  const tokens = await getPushTokens(userId);
  await Promise.all(tokens.map((token) => sendPushNotification(token, payload)));
}

// ─── Usage Tracking ──────────────────────────────────────────────────────────

async function updateUsage(userId, minutesUsed) {
  const month = new Date().toISOString().slice(0, 7);

  await supabase.from('usage').upsert(
    {
      user_id: userId,
      month,
      minutes_used: minutesUsed,
    },
    { onConflict: 'user_id,month' }
  );
}

async function markQuotaExceeded(userId) {
  const month = new Date().toISOString().slice(0, 7);
  const now = new Date().toISOString();

  await supabase
    .from('usage')
    .update({ quota_exceeded_at: now })
    .eq('user_id', userId)
    .eq('month', month);
}

// ─── Retry Storage ───────────────────────────────────────────────────────────

async function saveForRetry(userId, msg, audioBuffer, errorMessage) {
  const nextRetryAt = new Date(Date.now() + 30 * 1000).toISOString();

  const messageData = {
    key: msg.key,
    pushName: msg.pushName,
    durationSec: msg.message?.audioMessage?.seconds ?? 0,
  };

  await supabase.from('pending_transcriptions').insert({
    user_id: userId,
    message_data: messageData,
    audio_data: audioBuffer ? audioBuffer.toString('base64') : null,
    status: 'pending',
    last_error: errorMessage,
    next_retry_at: nextRetryAt,
  });
}

// ─── Main Pipeline ───────────────────────────────────────────────────────────

async function processAudioMessage(userId, msg, { isRetry = false } = {}) {
  const durationSec = msg.message?.audioMessage?.seconds ?? 0;
  const senderName = msg.pushName || msg.key?.remoteJid || 'Unknown';

  let tempPath = null;
  let audioBuffer = null;

  try {
    // ── Step 1: Check duration ────────────────────────────────────────────
    if (durationSec > MAX_DURATION_SEC) {
      await notifyUser(userId, {
        senderName,
        summary: `Message too long (max 10 min). This message was ${Math.ceil(durationSec / 60)} min.`,
        transcriptionId: null,
      });
      return;
    }

    // ── Step 2: Check monthly quota ───────────────────────────────────────
    const [monthlyLimit, usage] = await Promise.all([
      getMonthlyLimit(userId),
      getCurrentUsage(userId),
    ]);

    const minutesNeeded = Math.ceil(durationSec / 60);
    const totalAfter = usage.minutes_used + minutesNeeded;
    const quotaExceeded = totalAfter > monthlyLimit;

    if (quotaExceeded) {
      // First time hitting quota: record it and notify
      if (!usage.quota_exceeded_at) {
        await markQuotaExceeded(userId);
        await notifyUser(userId, {
          senderName,
          summary: `You've reached your monthly transcription limit. Upgrade your plan to continue.`,
          transcriptionId: null,
        });
      }

      // Soft block: if within 2-day buffer, save as visible=false
      const exceededAt = usage.quota_exceeded_at
        ? new Date(usage.quota_exceeded_at)
        : new Date();

      const softBlockEnd = new Date(exceededAt.getTime() + SOFT_BLOCK_DAYS * 24 * 60 * 60 * 1000);

      if (new Date() < softBlockEnd) {
        // Still in soft-block window — transcribe but save as invisible
        // (fall through with visible=false)
      } else {
        // Hard stop after 2 days
        return;
      }
    }

    // ── Step 3: Download audio ────────────────────────────────────────────
    const downloadMediaMessage = await getBaileysDownloader();
    audioBuffer = await downloadMediaMessage(msg, 'buffer', {});

    // ── Step 4: Write to temp file ────────────────────────────────────────
    tempPath = path.join(os.tmpdir(), `wa_audio_${userId}_${Date.now()}.ogg`);
    fs.writeFileSync(tempPath, audioBuffer);

    // ── Step 5: Transcribe via Groq Whisper ───────────────────────────────
    const transcript = await transcribeAudio(tempPath, null, config.groqApiKey);

    // ── Step 6: Summarize via Groq LLM ────────────────────────────────────
    const { summary, languageOk } = await summarizeTranscript(transcript, config.groqApiKey);

    // ── Step 7: Save to DB ────────────────────────────────────────────────
    const visible = !quotaExceeded; // invisible during soft-block

    const { data: txnData } = await supabase
      .from('transcriptions')
      .insert({
        user_id: userId,
        sender_name: senderName,
        sender_jid: msg.key?.remoteJid,
        audio_duration_sec: durationSec,
        transcript,
        summary,
        language_ok: languageOk,
        visible,
      })
      .select()
      .single();

    const transcriptionId = txnData?.id ?? null;

    // ── Step 8: Update usage ──────────────────────────────────────────────
    await updateUsage(userId, usage.minutes_used + minutesNeeded);

    // ── Step 9: Send push notification ───────────────────────────────────
    if (visible) {
      await notifyUser(userId, { senderName, summary, transcriptionId });
    }
  } catch (err) {
    if (isRetry) {
      throw err;
    }
    // Save for later retry
    await saveForRetry(userId, msg, audioBuffer, err.message || String(err));
  } finally {
    // ── Step 10: Clean up temp file ───────────────────────────────────────
    if (tempPath && fs.existsSync(tempPath)) {
      fs.unlinkSync(tempPath);
    }
  }
}

module.exports = { processAudioMessage, saveForRetry, getMonthlyLimit, getCurrentUsage };
