const { Expo } = require('expo-server-sdk');
const { sendPushNotification } = require('../services/push');

jest.mock('expo-server-sdk');

describe('push service', () => {
  let mockExpo;

  beforeEach(() => {
    mockExpo = {
      chunkPushNotifications: jest.fn((msgs) => [msgs]),
      sendPushNotificationsAsync: jest.fn().mockResolvedValue([{ status: 'ok' }]),
    };
    Expo.mockImplementation(() => mockExpo);
    Expo.isExpoPushToken = jest.fn().mockReturnValue(true);
  });

  afterEach(() => jest.resetAllMocks());

  test('sends notification with correct format', async () => {
    await sendPushNotification('ExponentPushToken[xxx]', {
      senderName: 'Marie',
      summary: 'She confirms dinner at 8pm.',
      transcriptionId: 'abc-123',
    });

    expect(mockExpo.sendPushNotificationsAsync).toHaveBeenCalledTimes(1);
    const [[notification]] = mockExpo.sendPushNotificationsAsync.mock.calls;
    expect(notification[0].to).toBe('ExponentPushToken[xxx]');
    expect(notification[0].title).toBe('🎙️ Marie');
    expect(notification[0].body).toBe('She confirms dinner at 8pm.');
    expect(notification[0].data.transcriptionId).toBe('abc-123');
  });

  test('truncates body to 100 chars', async () => {
    const longSummary = 'A'.repeat(150);

    await sendPushNotification('ExponentPushToken[xxx]', {
      senderName: 'Test',
      summary: longSummary,
      transcriptionId: 'abc',
    });

    const [[notification]] = mockExpo.sendPushNotificationsAsync.mock.calls;
    expect(notification[0].body.length).toBeLessThanOrEqual(103); // 100 + '...'
  });

  test('skips sending for invalid push token', async () => {
    Expo.isExpoPushToken.mockReturnValue(false);

    await sendPushNotification('invalid-token', {
      senderName: 'Test',
      summary: 'test',
      transcriptionId: 'abc',
    });

    expect(mockExpo.sendPushNotificationsAsync).not.toHaveBeenCalled();
  });
});
