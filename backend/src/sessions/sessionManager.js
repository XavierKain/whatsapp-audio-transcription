const EventEmitter = require('events');
const { createSession } = require('./createSession');
const supabase = require('../db/supabase');
const { sendPushNotification } = require('../services/push');

const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_DELAYS = [1000, 2000, 4000, 8000, 60000];
const STAGGER_DELAY_MS = 100;

class SessionManager {
  constructor() {
    this.sessions = new Map();
    this.emitter = new EventEmitter();
    this._setupInternalListeners();
  }

  _setupInternalListeners() {
    this.emitter.on('connection-changed', async ({ userId, status, authFailed, statusCode }) => {
      const session = this.sessions.get(userId);
      if (!session) return;

      if (status === 'connected') {
        session.status = 'connected';
        session.reconnectAttempts = 0;
        await supabase
          .from('whatsapp_sessions')
          .update({ status: 'connected', last_connected_at: new Date().toISOString() })
          .eq('user_id', userId);
      }

      if (status === 'disconnected' && authFailed) {
        session.status = 'disconnected';
        await supabase
          .from('whatsapp_sessions')
          .update({ status: 'disconnected' })
          .eq('user_id', userId);
        await this._notifyDisconnect(userId, 'WhatsApp session expired. Please re-link.');
      }

      if (status === 'reconnecting') {
        // Don't auto-reconnect while a pairing code is being entered
        if (session.isPairing) {
          console.log(`[SM] Ignoring reconnect for ${userId} — pairing in progress`);
          return;
        }

        session.reconnectAttempts = (session.reconnectAttempts || 0) + 1;

        if (session.reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
          session.status = 'disconnected';
          await supabase
            .from('whatsapp_sessions')
            .update({ status: 'disconnected' })
            .eq('user_id', userId);
          await this._notifyDisconnect(userId, 'WhatsApp disconnected after multiple retries.');
          return;
        }

        const delay = RECONNECT_DELAYS[
          Math.min(session.reconnectAttempts - 1, RECONNECT_DELAYS.length - 1)
        ];
        session.status = 'reconnecting';

        setTimeout(async () => {
          try {
            if (session.cleanup) session.cleanup();
            const { sock, cleanup } = await createSession(userId, this.emitter);
            session.sock = sock;
            session.cleanup = cleanup;
          } catch (err) {
            console.error(`Reconnect failed for ${userId}:`, err.message);
            this.emitter.emit('connection-changed', {
              userId,
              status: 'reconnecting',
              statusCode: 500,
            });
          }
        }, delay);
      }
    });
  }

  async _notifyDisconnect(userId, message) {
    try {
      const { data: tokens } = await supabase
        .from('push_tokens')
        .select('expo_push_token')
        .eq('user_id', userId);

      for (const { expo_push_token } of tokens || []) {
        await sendPushNotification(expo_push_token, {
          senderName: 'VoiceScribe',
          summary: message,
          transcriptionId: '',
        });
      }
    } catch (err) {
      console.error(`Failed to notify user ${userId}:`, err.message);
    }
  }

  async requestPairingCode(userId, phoneNumber) {
    if (this.sessions.has(userId)) {
      const existing = this.sessions.get(userId);
      if (existing.cleanup) existing.cleanup();
    }

    const { sock, cleanup } = await createSession(userId, this.emitter);
    // Mark as pairing so reconnect logic doesn't interfere
    this.sessions.set(userId, { sock, cleanup, status: 'pairing', reconnectAttempts: 0, isPairing: true });

    await supabase.from('whatsapp_sessions').upsert({
      user_id: userId,
      phone_number: phoneNumber,
      status: 'pending',
      credentials_json: '',
    });

    // Wait for QR event — this means the socket is connected to WA servers
    // and ready for authentication (either QR scan or pairing code)
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('WhatsApp connection timeout. Please try again.')), 60000);

      const handler = ({ connection, qr }) => {
        if (qr) {
          // QR generated = socket is ready for pairing code
          clearTimeout(timeout);
          sock.ev.off('connection.update', handler);
          resolve();
        }
        if (connection === 'close') {
          clearTimeout(timeout);
          sock.ev.off('connection.update', handler);
          reject(new Error('WhatsApp connection closed. Please try again.'));
        }
      };

      sock.ev.on('connection.update', handler);
    });

    console.log(`[PAIR] Socket ready, requesting pairing code for ${phoneNumber}`);
    const code = await sock.requestPairingCode(phoneNumber);
    console.log(`[PAIR] Got code: ${code}`);

    // Clear pairing flag so reconnect logic can work after successful pairing
    const session = this.sessions.get(userId);
    if (session) session.isPairing = false;

    return code;
  }

  async startSession(userId) {
    if (this.sessions.has(userId)) return;

    const { sock, cleanup } = await createSession(userId, this.emitter);
    this.sessions.set(userId, { sock, cleanup, status: 'connecting', reconnectAttempts: 0 });
  }

  async stopSession(userId) {
    const session = this.sessions.get(userId);
    if (!session) return;

    if (session.cleanup) session.cleanup();
    this.sessions.delete(userId);

    await supabase
      .from('whatsapp_sessions')
      .update({ status: 'disconnected' })
      .eq('user_id', userId);
  }

  getStatus(userId) {
    const session = this.sessions.get(userId);
    return session?.status || 'disconnected';
  }

  async restoreAllSessions() {
    const { data: sessions, error } = await supabase
      .from('whatsapp_sessions')
      .select('user_id')
      .eq('status', 'connected');

    if (error || !sessions) {
      console.error('Failed to load sessions:', error?.message);
      return;
    }

    console.log(`Restoring ${sessions.length} WhatsApp sessions...`);

    for (const { user_id } of sessions) {
      try {
        await this.startSession(user_id);
        await new Promise((resolve) => setTimeout(resolve, STAGGER_DELAY_MS));
      } catch (err) {
        console.error(`Failed to restore session for ${user_id}:`, err.message);
      }
    }
  }

  shutdown() {
    for (const [userId, session] of this.sessions) {
      if (session.cleanup) session.cleanup();
    }
    this.sessions.clear();
    this.emitter.removeAllListeners();
  }
}

module.exports = { SessionManager };
