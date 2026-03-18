'use strict';

// Mock processAudioMessage before requiring retryWorker
jest.mock('../pipeline/transcribe', () => ({
  processAudioMessage: jest.fn(),
}));

// Mock push service
jest.mock('../services/push', () => ({
  sendPushNotification: jest.fn(),
}));

// Supabase mock — variable with "mock" prefix so Jest's scope guard allows it
let mockSupabaseFromImpl = jest.fn();

jest.mock('../db/supabase', () => ({
  from: (...args) => mockSupabaseFromImpl(...args),
}));

const { processAudioMessage } = require('../pipeline/transcribe');
const { sendPushNotification } = require('../services/push');
const { processRetryQueue } = require('../pipeline/retryWorker');

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Build a per-table supabase chain factory.
 *
 * Supports:
 *   .select().eq().lte()         → awaitable (list of rows)  ← pending_transcriptions query
 *   .select().eq()               → awaitable (list of rows)  ← push_tokens query
 *   .update().eq()               → awaitable
 *   .delete().eq()               → awaitable
 */
function buildTableChain(result) {
  const resolved = result || { data: null, error: null };

  function makeEqNode() {
    const p = Promise.resolve(resolved);
    const node = {
      then: p.then.bind(p),
      catch: p.catch.bind(p),
      finally: p.finally.bind(p),
      single: jest.fn().mockResolvedValue(resolved),
      maybeSingle: jest.fn().mockResolvedValue(resolved),
      eq: jest.fn().mockImplementation(() => makeEqNode()),
      lte: jest.fn().mockImplementation(() => makeEqNode()),
    };
    return node;
  }

  // select() → returns an eq-node with .eq() and .lte() chaining
  const selectChain = jest.fn().mockImplementation(() => makeEqNode());

  // update().eq() — awaitable
  const updateChain = jest.fn().mockReturnValue(makeEqNode());

  // delete().eq() — awaitable
  const deleteChain = jest.fn().mockReturnValue(makeEqNode());

  return {
    select: selectChain,
    update: updateChain,
    delete: deleteChain,
  };
}

function setupSupabaseMock({
  pendingTranscriptions = { data: [], error: null },
  pushTokens = { data: [], error: null },
} = {}) {
  const tableMap = {
    pending_transcriptions: buildTableChain(pendingTranscriptions),
    push_tokens: buildTableChain(pushTokens),
  };

  mockSupabaseFromImpl.mockImplementation((table) => {
    if (tableMap[table]) return tableMap[table];
    return buildTableChain({ data: null, error: null });
  });

  return tableMap;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('processRetryQueue', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2025-06-15T10:00:00.000Z'));
    mockSupabaseFromImpl = jest.fn();
    processAudioMessage.mockReset();
    sendPushNotification.mockReset();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.resetAllMocks();
  });

  test('picks up pending jobs and processes them successfully', async () => {
    const job = {
      id: 'job-1',
      user_id: 'user-123',
      attempts: 0,
      message_data: { pushName: 'Alice', key: { remoteJid: 'alice@s.whatsapp.net' } },
      status: 'pending',
      next_retry_at: '2025-06-15T09:59:00.000Z',
    };

    setupSupabaseMock({
      pendingTranscriptions: { data: [job], error: null },
    });

    processAudioMessage.mockResolvedValue(undefined);

    await processRetryQueue();

    // Should have called processAudioMessage with isRetry: true
    expect(processAudioMessage).toHaveBeenCalledWith(
      'user-123',
      job.message_data,
      { isRetry: true }
    );

    // Should have called delete after success
    expect(mockSupabaseFromImpl).toHaveBeenCalledWith('pending_transcriptions');
  });

  test('marks job as failed after 3 attempts and sends push notification', async () => {
    const job = {
      id: 'job-2',
      user_id: 'user-456',
      attempts: 3, // >= MAX_ATTEMPTS
      message_data: { pushName: 'Bob', key: { remoteJid: 'bob@s.whatsapp.net' } },
      status: 'pending',
      next_retry_at: '2025-06-15T09:50:00.000Z',
    };

    const pushToken = 'ExponentPushToken[abc123]';

    setupSupabaseMock({
      pendingTranscriptions: { data: [job], error: null },
      pushTokens: { data: [{ expo_push_token: pushToken }], error: null },
    });

    sendPushNotification.mockResolvedValue(undefined);

    await processRetryQueue();

    // processAudioMessage should NOT be called for failed jobs
    expect(processAudioMessage).not.toHaveBeenCalled();

    // Should have updated status to 'failed'
    const ptChain = mockSupabaseFromImpl.mock.results.find(
      (r, i) => mockSupabaseFromImpl.mock.calls[i][0] === 'pending_transcriptions' &&
                r.value.update
    );
    expect(ptChain).toBeDefined();

    // Should have sent push notification
    expect(sendPushNotification).toHaveBeenCalledWith(
      pushToken,
      expect.objectContaining({
        senderName: 'Bob',
        summary: 'Failed to transcribe voice message after multiple attempts.',
        transcriptionId: '',
      })
    );
  });
});
