const { Expo } = require('expo-server-sdk');

async function sendPushNotification(pushToken, { senderName, summary, transcriptionId }) {
  const expo = new Expo();
  if (!Expo.isExpoPushToken(pushToken)) {
    console.warn(`Invalid Expo push token: ${pushToken}`);
    return;
  }

  const body = summary.length > 100 ? summary.slice(0, 100) + '...' : summary;

  const messages = [
    {
      to: pushToken,
      sound: 'default',
      title: `🎙️ ${senderName}`,
      body,
      data: { transcriptionId },
    },
  ];

  const chunks = expo.chunkPushNotifications(messages);
  for (const chunk of chunks) {
    await expo.sendPushNotificationsAsync(chunk);
  }
}

module.exports = { sendPushNotification };
