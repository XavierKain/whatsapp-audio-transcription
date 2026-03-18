const EventEmitter = require('events');

// Mock createSession before requiring sessionManager
const mockSock = {
  requestPairingCode: jest.fn().mockResolvedValue('ABCD1234'),
  end: jest.fn(),
  ev: {
    removeAllListeners: jest.fn(),
    // Fire connection.update immediately with 'connecting' so the readiness wait resolves
    on: jest.fn((event, handler) => {
      if (event === 'connection.update') {
        handler({ connection: 'connecting' });
      }
    }),
  },
};
const mockCleanup = jest.fn();

jest.mock('../sessions/createSession', () => ({
  createSession: jest.fn().mockResolvedValue({ sock: mockSock, cleanup: mockCleanup }),
}));

jest.mock('../db/supabase', () => ({
  from: jest.fn().mockReturnValue({
    select: jest.fn().mockReturnValue({
      eq: jest.fn().mockResolvedValue({ data: [], error: null }),
    }),
    update: jest.fn().mockReturnValue({
      eq: jest.fn().mockResolvedValue({ error: null }),
    }),
    upsert: jest.fn().mockResolvedValue({ error: null }),
  }),
}));

jest.mock('../services/push', () => ({
  sendPushNotification: jest.fn().mockResolvedValue(undefined),
}));

const { SessionManager } = require('../sessions/sessionManager');

describe('SessionManager', () => {
  let manager;

  beforeEach(() => {
    manager = new SessionManager();
    jest.clearAllMocks();
  });

  afterEach(() => {
    manager.shutdown();
  });

  test('getStatus returns "disconnected" for unknown user', () => {
    expect(manager.getStatus('unknown-user')).toBe('disconnected');
  });

  test('requestPairingCode creates session and returns code', async () => {
    const code = await manager.requestPairingCode('user-1', '+33612345678');

    expect(code).toBe('ABCD1234');
    expect(mockSock.requestPairingCode).toHaveBeenCalledWith('+33612345678');
  });

  test('stopSession cleans up and removes from registry', async () => {
    await manager.requestPairingCode('user-1', '+33612345678');
    await manager.stopSession('user-1');

    expect(mockCleanup).toHaveBeenCalled();
    expect(manager.getStatus('user-1')).toBe('disconnected');
  });

  test('emitter is accessible for pipeline to listen on', () => {
    expect(manager.emitter).toBeInstanceOf(EventEmitter);
  });
});
