const pino = require('pino');
const { useSupabaseAuthState } = require('./authState');
const config = require('../config');

const BAILEYS_CONFIG = {
  browser: ['Mac OS', 'Desktop', '10.15.7'],
  syncFullHistory: false,
  markOnlineOnConnect: false,
  generateHighQualityLinkPreview: false,
  keepAliveIntervalMs: 30000,
};

async function createSession(userId, emitter) {
  // @whiskeysockets/baileys is ESM-only, so we use dynamic import
  const {
    default: makeWASocket,
    downloadMediaMessage,
    DisconnectReason,
    fetchLatestBaileysVersion,
  } = await import('@whiskeysockets/baileys');

  const { Boom } = require('@hapi/boom');

  const { state, saveCreds } = await useSupabaseAuthState(userId, config.encryptionKey);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }),
    ...BAILEYS_CONFIG,
  });

  sock.ev.on('creds.update', () => saveCreds());

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const msg of messages) {
      if (msg.key.fromMe) continue;

      const isAudio = msg.message?.audioMessage || msg.message?.pttMessage;
      if (!isAudio) continue;

      emitter.emit('audio-received', { userId, message: msg });
    }
  });

  sock.ev.on('connection.update', async ({ connection, lastDisconnect }) => {
    if (connection === 'open') {
      sock.sendPresenceUpdate('unavailable').catch(() => {});
      emitter.emit('connection-changed', { userId, status: 'connected' });
    }

    if (connection === 'close') {
      const statusCode = new Boom(lastDisconnect?.error)?.output?.statusCode;

      if (statusCode === DisconnectReason.loggedOut || statusCode === 401) {
        emitter.emit('connection-changed', { userId, status: 'disconnected', authFailed: true });
        return;
      }

      emitter.emit('connection-changed', { userId, status: 'reconnecting', statusCode });
    }
  });

  const cleanup = () => {
    sock.ev.removeAllListeners();
    sock.end(undefined);
  };

  return { sock, cleanup };
}

module.exports = { createSession };
