const { encrypt, decrypt } = require('../services/encryption');

// Mock supabase - factory avoids hoisting issues
jest.mock('../db/supabase', () => ({
  from: jest.fn(),
}));

// Mock baileys (ESM module) - provide fake initAuthCreds and proto
jest.mock('baileys', () => ({
  initAuthCreds: jest.fn(() => ({
    noiseKey: { private: Buffer.alloc(32), public: Buffer.alloc(32) },
    signedIdentityKey: { private: Buffer.alloc(32), public: Buffer.alloc(32) },
    signedPreKey: {
      keyPair: { private: Buffer.alloc(32), public: Buffer.alloc(32) },
      signature: Buffer.alloc(64),
      keyId: 1,
    },
    registrationId: 12345,
    advSecretKey: Buffer.alloc(32).toString('base64'),
    processedHistoryMessages: [],
    nextPreKeyId: 1,
    firstUnuploadedPreKeyId: 1,
    accountSettings: { unarchiveChats: false },
    me: undefined,
  })),
  proto: {
    Message: {
      AppStateSyncKeyData: {
        fromObject: jest.fn((val) => val),
      },
    },
  },
}));

const { useSupabaseAuthState } = require('../sessions/authState');
const supabase = require('../db/supabase');

const TEST_KEY = 'a'.repeat(64);

describe('useSupabaseAuthState', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns initialized creds when no credentials exist', async () => {
    supabase.from.mockReturnValue({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          single: jest.fn().mockResolvedValue({ data: null, error: null }),
        }),
      }),
    });

    const { state } = await useSupabaseAuthState('user-123', TEST_KEY);

    // initAuthCreds() returns a full creds object with noiseKey, signedIdentityKey, etc.
    expect(state.creds).toBeDefined();
    expect(state.creds.noiseKey).toBeDefined();
    expect(state.keys).toBeDefined();
  });

  test('loads and decrypts existing credentials', async () => {
    const creds = { me: { id: '1234@s.whatsapp.net' } };
    const encrypted = encrypt(JSON.stringify({ creds, keys: {} }), TEST_KEY);

    supabase.from.mockReturnValue({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          single: jest.fn().mockResolvedValue({
            data: { credentials_json: encrypted },
            error: null,
          }),
        }),
      }),
    });

    const { state } = await useSupabaseAuthState('user-123', TEST_KEY);

    expect(state.creds.me.id).toBe('1234@s.whatsapp.net');
  });

  test('saveCreds encrypts and updates in Supabase', async () => {
    const mockEq = jest.fn().mockResolvedValue({ error: null });
    const mockUpdate = jest.fn().mockReturnValue({ eq: mockEq });
    supabase.from
      .mockReturnValueOnce({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({ data: null, error: null }),
          }),
        }),
      })
      .mockReturnValueOnce({ update: mockUpdate });

    const { saveCreds } = await useSupabaseAuthState('user-123', TEST_KEY);
    await saveCreds({ me: { id: 'new@s.whatsapp.net' } });

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    const [updateData] = mockUpdate.mock.calls[0];
    // Verify the data is encrypted (not plaintext)
    expect(updateData.credentials_json).not.toContain('new@s.whatsapp.net');
    // Verify we can decrypt it
    const decrypted = JSON.parse(decrypt(updateData.credentials_json, TEST_KEY));
    expect(decrypted.creds.me.id).toBe('new@s.whatsapp.net');
  });
});
