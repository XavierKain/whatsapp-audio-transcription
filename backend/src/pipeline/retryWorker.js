const supabase = require('../db/supabase');
const { processAudioMessage } = require('./transcribe');
const { sendPushNotification } = require('../services/push');

const MAX_ATTEMPTS = 3;
const RETRY_DELAYS = [30000, 60000, 120000];
const POLL_INTERVAL_MS = 15000;

async function processRetryQueue() {
  const now = new Date().toISOString();
  const { data: jobs } = await supabase
    .from('pending_transcriptions')
    .select('*')
    .eq('status', 'pending')
    .lte('next_retry_at', now);

  if (!jobs || jobs.length === 0) return;

  for (const job of jobs) {
    if (job.attempts >= MAX_ATTEMPTS) {
      await supabase.from('pending_transcriptions')
        .update({ status: 'failed', last_error: 'Max attempts reached' })
        .eq('id', job.id);

      const { data: tokens } = await supabase
        .from('push_tokens').select('expo_push_token').eq('user_id', job.user_id);

      for (const { expo_push_token } of tokens || []) {
        await sendPushNotification(expo_push_token, {
          senderName: job.message_data?.pushName || 'Unknown',
          summary: 'Failed to transcribe voice message after multiple attempts.',
          transcriptionId: '',
        });
      }
      continue;
    }

    await supabase.from('pending_transcriptions')
      .update({ status: 'processing' })
      .eq('id', job.id);

    try {
      await processAudioMessage(job.user_id, job.message_data, { isRetry: true });
      await supabase.from('pending_transcriptions').delete().eq('id', job.id);
    } catch (err) {
      const nextAttempt = job.attempts + 1;
      const delay = RETRY_DELAYS[Math.min(nextAttempt - 1, RETRY_DELAYS.length - 1)];
      await supabase.from('pending_transcriptions')
        .update({
          status: 'pending',
          attempts: nextAttempt,
          last_error: err.message,
          next_retry_at: new Date(Date.now() + delay).toISOString(),
        })
        .eq('id', job.id);
    }
  }
}

let intervalId = null;
function startRetryWorker() {
  console.log('Retry worker started (polling every 15s)');
  intervalId = setInterval(processRetryQueue, POLL_INTERVAL_MS);
  processRetryQueue().catch(console.error);
}
function stopRetryWorker() {
  if (intervalId) { clearInterval(intervalId); intervalId = null; }
}

module.exports = { processRetryQueue, startRetryWorker, stopRetryWorker };
