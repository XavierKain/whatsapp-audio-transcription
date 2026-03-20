const fs = require('fs');

// Mock baileys (ESM-only) — must be declared before any require
jest.mock('baileys', () => ({
  downloadMediaMessage: jest.fn(),
}));

// Mock groq service
jest.mock('../services/groq', () => ({
  transcribeAudio: jest.fn(),
  summarizeTranscript: jest.fn(),
}));

// Mock push service
jest.mock('../services/push', () => ({
  sendPushNotification: jest.fn(),
}));

// Mock config
jest.mock('../config', () => ({
  groqApiKey: 'test-groq-key',
}));

// Partial mock of fs — only mock specific functions
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  writeFileSync: jest.fn(),
  existsSync: jest.fn(),
  unlinkSync: jest.fn(),
}));

// Supabase mock — the factory references mockSupabaseFromImpl which is
// a variable with the "mock" prefix (allowed by Jest's scope guard).
// We swap out its implementation per-test in beforeEach.
let mockSupabaseFromImpl = jest.fn();

jest.mock('../db/supabase', () => ({
  from: (...args) => mockSupabaseFromImpl(...args),
}));

const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const { transcribeAudio, summarizeTranscript } = require('../services/groq');
const { sendPushNotification } = require('../services/push');

// Import pipeline AFTER all mocks are in place
const { processAudioMessage } = require('../pipeline/transcribe');

// ─── Helpers ────────────────────────────────────────────────────────────────

const NOW = new Date('2025-06-15T10:00:00.000Z');

function makeMsg({ durationSec = 30, senderName = 'Alice', senderJid = 'alice@s.whatsapp.net' } = {}) {
  return {
    message: {
      audioMessage: {
        seconds: durationSec,
      },
    },
    key: { remoteJid: senderJid },
    pushName: senderName,
  };
}

/**
 * Build a per-table supabase chain factory.
 *
 * Supports these query patterns:
 *   .select().eq().single()          → resolved (single row)
 *   .select().eq().maybeSingle()     → resolved (single row or null)
 *   .select().eq()                   → awaitable (list of rows)  ← push_tokens uses this
 *   .insert({ ... }).select().single() → resolved (inserted row)
 *   .update({ ... }).eq()            → resolved { error }
 *   .upsert()                        → resolved { error }
 */
function buildTableChain(result) {
  const resolved = result || { data: null, error: null };

  /**
   * Create a "thenable chain" node: a jest.fn that
   *   - when awaited, resolves to `resolveWith`
   *   - also has .eq/.single/.maybeSingle properties for further chaining
   */
  function makeThenable(resolveWith) {
    const p = Promise.resolve(resolveWith);
    const fn = jest.fn().mockImplementation(() => makeEqNode());
    // Make fn itself awaitable by forwarding Promise protocol
    fn.then = p.then.bind(p);
    fn.catch = p.catch.bind(p);
    fn.finally = p.finally.bind(p);
    fn.single = jest.fn().mockResolvedValue(resolveWith);
    fn.maybeSingle = jest.fn().mockResolvedValue(resolveWith);
    fn.eq = jest.fn().mockImplementation(() => makeEqNode());
    return fn;
  }

  /**
   * An eq-node: awaitable AND chainable with more .eq(), .single(), .maybeSingle()
   */
  function makeEqNode() {
    const p = Promise.resolve(resolved);
    const node = {
      then: p.then.bind(p),
      catch: p.catch.bind(p),
      finally: p.finally.bind(p),
      single: jest.fn().mockResolvedValue(resolved),
      maybeSingle: jest.fn().mockResolvedValue(resolved),
      eq: jest.fn().mockImplementation(() => makeEqNode()),
    };
    return node;
  }

  // insert().select().single()
  const insertSelectSingle = jest.fn().mockResolvedValue(resolved);
  const insertSelect = jest.fn().mockReturnValue({ single: insertSelectSingle });
  const insertChain = jest.fn().mockReturnValue({ select: insertSelect });

  // update().eq() — awaitable
  const updateChain = jest.fn().mockReturnValue(makeEqNode());

  // upsert() — awaitable
  const upsertChain = jest.fn().mockResolvedValue({ error: null });

  // select() → returns an eq-node directly
  const selectChain = jest.fn().mockImplementation(() => makeEqNode());

  return {
    select: selectChain,
    insert: insertChain,
    update: updateChain,
    upsert: upsertChain,
  };
}

/**
 * Wire up mockSupabaseFromImpl to serve per-table data.
 */
function setupSupabaseMock({
  subscriptions = { data: { plan: 'free', extra_minutes_per_month: 0, addon_expires_at: null, bonus_minutes: 0 }, error: null },
  usage = { data: { minutes_used: 0, quota_exceeded_at: null }, error: null },
  userSettings = { data: { notifications_enabled: true }, error: null },
  pushTokens = { data: [{ expo_push_token: 'ExponentPushToken[test]' }], error: null },
  transcriptions = { data: { id: 'txn-1' }, error: null },
  pendingTranscriptions = { data: null, error: null },
} = {}) {
  const tableMap = {
    subscriptions: buildTableChain(subscriptions),
    usage: buildTableChain(usage),
    user_settings: buildTableChain(userSettings),
    push_tokens: buildTableChain(pushTokens),
    transcriptions: buildTableChain(transcriptions),
    pending_transcriptions: buildTableChain(pendingTranscriptions),
  };

  mockSupabaseFromImpl.mockImplementation((table) => {
    if (tableMap[table]) return tableMap[table];
    // Fallback for unknown tables
    return buildTableChain({ data: null, error: null });
  });

  return tableMap;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('processAudioMessage', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);

    mockSupabaseFromImpl = jest.fn();
    setupSupabaseMock();

    // Default groq mocks
    downloadMediaMessage.mockResolvedValue(Buffer.from('fake-audio'));
    transcribeAudio.mockResolvedValue('This is the full transcript.');
    summarizeTranscript.mockResolvedValue({ summary: 'Short summary.', languageOk: true });
    sendPushNotification.mockResolvedValue(undefined);

    // fs mocks
    fs.writeFileSync.mockClear();
    fs.existsSync.mockReturnValue(true);
    fs.unlinkSync.mockClear();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.resetAllMocks();
  });

  test('processes audio message end-to-end', async () => {
    const msg = makeMsg({ durationSec: 30, senderName: 'Alice' });

    await processAudioMessage('user-123', msg);

    // Groq was called
    expect(transcribeAudio).toHaveBeenCalledTimes(1);
    expect(summarizeTranscript).toHaveBeenCalledWith('This is the full transcript.', 'test-groq-key');

    // Push notification sent with correct sender and summary
    expect(sendPushNotification).toHaveBeenCalledTimes(1);
    const [token, payload] = sendPushNotification.mock.calls[0];
    expect(token).toBe('ExponentPushToken[test]');
    expect(payload.senderName).toBe('Alice');
    expect(payload.summary).toBe('Short summary.');
  });

  test('rejects audio longer than 10 minutes', async () => {
    const msg = makeMsg({ durationSec: 650, senderName: 'Bob' }); // > 600s

    await processAudioMessage('user-123', msg);

    // Groq should NOT be called
    expect(transcribeAudio).not.toHaveBeenCalled();

    // Push notification sent with "10 min" in the message
    expect(sendPushNotification).toHaveBeenCalledTimes(1);
    const [, payload] = sendPushNotification.mock.calls[0];
    expect(payload.summary).toMatch(/10 min/i);
  });

  test('cleans up temp file after processing', async () => {
    const msg = makeMsg({ durationSec: 30 });

    await processAudioMessage('user-123', msg);

    expect(fs.unlinkSync).toHaveBeenCalledTimes(1);
  });
});
