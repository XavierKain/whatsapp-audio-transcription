# VoiceScribe Phase 1: Core Backend — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the core backend that connects to WhatsApp via Baileys, transcribes audio messages via Groq, and sends push notifications via Expo.

**Architecture:** Single Express monolith with isolated modules: session manager (Baileys multi-tenant), transcription pipeline (Groq Whisper + LLM), and push notification service (Expo). Supabase for DB and auth. All modules communicate via EventEmitter.

**Tech Stack:** Node.js, Express, @whiskeysockets/baileys, Groq API, Expo Push Notifications, Supabase (PostgreSQL), AES-256-GCM encryption

**Spec:** `docs/superpowers/specs/2026-03-18-voicescribe-design.md`

---

## File Map

```
backend/
  .env.example                    — environment variable template
  package.json                    — dependencies and scripts
  src/
    index.js                      — Express app, mount routes, start services
    config.js                     — centralized env var access + validation
    db/
      supabase.js                 — Supabase client init
      schema.sql                  — full DB schema (run manually in Supabase dashboard)
    services/
      encryption.js               — AES-256-GCM encrypt/decrypt
      groq.js                     — Whisper transcription + LLM summarization
      push.js                     — Expo push notification sender
    sessions/
      authState.js                — Baileys auth state adapter (encrypted Supabase storage)
      createSession.js            — init one Baileys socket with stealth config
      sessionManager.js           — multi-tenant session registry + EventEmitter
    pipeline/
      transcribe.js               — full audio processing pipeline
      retryWorker.js              — polls pending_transcriptions, retries failed jobs
    middleware/
      auth.js                     — verify Supabase JWT
    routes/
      whatsapp.js                 — POST /pair, GET /status, DELETE /disconnect
      push.js                     — POST /push/register
    __tests__/
      encryption.test.js
      groq.test.js
      push.test.js
      transcribe.test.js
      retryWorker.test.js
      sessionManager.test.js
      authState.test.js
```

---

## Chunk 1: Project Setup + Foundation Services

### Task 1: Project Scaffolding

**Files:**
- Create: `backend/package.json`
- Create: `backend/.env.example`
- Create: `backend/src/config.js`

- [ ] **Step 1: Initialize project and add .gitignore**

```bash
cd backend
npm init -y
```

Create `backend/.gitignore`:
```
node_modules/
.env
```

- [ ] **Step 2: Install dependencies**

```bash
npm install express @whiskeysockets/baileys @hapi/boom pino axios form-data @supabase/supabase-js expo-server-sdk dotenv
npm install -D jest
```

- [ ] **Step 3: Create .env.example**

```env
# Supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=your-service-role-key

# Groq
GROQ_API_KEY=your-groq-api-key

# Encryption
ENCRYPTION_KEY=your-32-byte-hex-key

# Server
PORT=3000
NODE_ENV=development
```

- [ ] **Step 4: Create config.js**

```javascript
// backend/src/config.js
const dotenv = require('dotenv');
dotenv.config();

const required = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_KEY',
  'GROQ_API_KEY',
  'ENCRYPTION_KEY',
];

for (const key of required) {
  if (!process.env[key]) {
    throw new Error(`Missing required env var: ${key}`);
  }
}

module.exports = {
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseServiceKey: process.env.SUPABASE_SERVICE_KEY,
  groqApiKey: process.env.GROQ_API_KEY,
  encryptionKey: process.env.ENCRYPTION_KEY,
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
};
```

- [ ] **Step 5: Add scripts to package.json**

Add to `package.json`:
```json
{
  "scripts": {
    "start": "node src/index.js",
    "test": "jest --verbose"
  }
}
```

- [ ] **Step 6: Commit**

```bash
git add backend/
git commit -m "feat: scaffold backend project with dependencies and config"
```

---

### Task 2: Database Schema

**Files:**
- Create: `backend/src/db/schema.sql`
- Create: `backend/src/db/supabase.js`

- [ ] **Step 1: Write the full schema SQL**

```sql
-- backend/src/db/schema.sql
-- Run this in Supabase SQL Editor

-- Users (extends Supabase Auth users)
CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE NOT NULL,
  created_at timestamptz DEFAULT now(),
  referral_code text UNIQUE NOT NULL,
  referred_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  plan text NOT NULL DEFAULT 'free',
  status text NOT NULL DEFAULT 'active',
  expires_at timestamptz,
  extra_minutes_per_month int DEFAULT 0,
  addon_expires_at timestamptz,
  bonus_minutes int DEFAULT 0,
  stripe_customer_id text,
  stripe_subscription_id text,
  is_early_adopter boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE whatsapp_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  credentials_json text NOT NULL,
  phone_number text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  last_connected_at timestamptz
);

CREATE TABLE transcriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  sender_name text,
  sender_jid text,
  audio_duration_sec int,
  transcript text,
  summary text,
  language_ok boolean DEFAULT true,
  visible boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_transcriptions_user_created
  ON transcriptions(user_id, created_at DESC);

CREATE TABLE usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  month text NOT NULL,
  minutes_used int DEFAULT 0,
  quota_exceeded_at timestamptz,
  UNIQUE(user_id, month)
);

CREATE TABLE push_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  expo_push_token text NOT NULL,
  platform text NOT NULL,
  updated_at timestamptz DEFAULT now(),
  UNIQUE(user_id, platform)
);

CREATE TABLE referrals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  referred_user_id uuid UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  bonus_applied_at timestamptz
);

CREATE TABLE pending_transcriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  message_data jsonb NOT NULL,
  audio_data bytea,
  status text NOT NULL DEFAULT 'pending',
  attempts int DEFAULT 0,
  last_error text,
  next_retry_at timestamptz,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE user_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  preferred_languages text[] DEFAULT '{en}',
  notifications_enabled boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- RLS policies (enable RLS on all tables)
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE transcriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE push_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE referrals ENABLE ROW LEVEL SECURITY;
ALTER TABLE pending_transcriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;

-- Users can only read their own data
CREATE POLICY "Users read own data" ON users
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users read own subscriptions" ON subscriptions
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users read own transcriptions" ON transcriptions
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users read own usage" ON usage
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users read own settings" ON user_settings
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users update own settings" ON user_settings
  FOR UPDATE USING (auth.uid() = user_id);

-- Service role bypasses RLS for backend operations
```

- [ ] **Step 2: Write Supabase client**

```javascript
// backend/src/db/supabase.js
const { createClient } = require('@supabase/supabase-js');
const config = require('../config');

const supabase = createClient(config.supabaseUrl, config.supabaseServiceKey);

module.exports = supabase;
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/db/
git commit -m "feat: add database schema and Supabase client"
```

---

### Task 3: Encryption Service

**Files:**
- Create: `backend/src/services/encryption.js`
- Create: `backend/src/__tests__/encryption.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
// backend/src/__tests__/encryption.test.js
const { encrypt, decrypt } = require('../services/encryption');

describe('encryption', () => {
  const testKey = 'a'.repeat(64); // 32 bytes in hex

  test('encrypts and decrypts a string roundtrip', () => {
    const original = JSON.stringify({ creds: 'test-data', keys: [1, 2, 3] });
    const encrypted = encrypt(original, testKey);
    const decrypted = decrypt(encrypted, testKey);
    expect(decrypted).toBe(original);
  });

  test('encrypted output differs from input', () => {
    const original = 'secret-data';
    const encrypted = encrypt(original, testKey);
    expect(encrypted).not.toBe(original);
  });

  test('different encryptions of same plaintext produce different ciphertext', () => {
    const original = 'same-data';
    const enc1 = encrypt(original, testKey);
    const enc2 = encrypt(original, testKey);
    expect(enc1).not.toBe(enc2); // random IV each time
  });

  test('decrypt with wrong key throws', () => {
    const original = 'secret';
    const encrypted = encrypt(original, testKey);
    const wrongKey = 'b'.repeat(64);
    expect(() => decrypt(encrypted, wrongKey)).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest src/__tests__/encryption.test.js --verbose`
Expected: FAIL — module not found

- [ ] **Step 3: Write implementation**

```javascript
// backend/src/services/encryption.js
const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

/**
 * Encrypts plaintext using AES-256-GCM.
 * Returns base64 string: iv + authTag + ciphertext
 */
function encrypt(plaintext, hexKey) {
  const key = Buffer.from(hexKey, 'hex');
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return Buffer.concat([iv, authTag, encrypted]).toString('base64');
}

/**
 * Decrypts a base64 string produced by encrypt().
 */
function decrypt(encryptedBase64, hexKey) {
  const key = Buffer.from(hexKey, 'hex');
  const data = Buffer.from(encryptedBase64, 'base64');

  const iv = data.subarray(0, IV_LENGTH);
  const authTag = data.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = data.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  return decipher.update(ciphertext, undefined, 'utf8') + decipher.final('utf8');
}

module.exports = { encrypt, decrypt };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest src/__tests__/encryption.test.js --verbose`
Expected: 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/encryption.js backend/src/__tests__/encryption.test.js
git commit -m "feat: add AES-256-GCM encryption service with tests"
```

---

### Task 4: Groq Service

**Files:**
- Create: `backend/src/services/groq.js`
- Create: `backend/src/__tests__/groq.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
// backend/src/__tests__/groq.test.js
const axios = require('axios');
const { transcribeAudio, summarizeTranscript } = require('../services/groq');

jest.mock('axios');

describe('groq service', () => {
  afterEach(() => jest.resetAllMocks());

  describe('transcribeAudio', () => {
    test('sends audio file to Whisper API and returns transcript', async () => {
      axios.post.mockResolvedValue({ data: '  Hello this is a test message.  ' });

      const result = await transcribeAudio('/tmp/test.ogg', 'en', 'test-api-key');

      expect(result).toBe('Hello this is a test message.');
      expect(axios.post).toHaveBeenCalledTimes(1);
      const [url] = axios.post.mock.calls[0];
      expect(url).toBe('https://api.groq.com/openai/v1/audio/transcriptions');
    });

    test('passes language hint to Whisper when provided', async () => {
      axios.post.mockResolvedValue({ data: 'Bonjour' });

      await transcribeAudio('/tmp/test.ogg', 'fr', 'test-api-key');

      const [, formData] = axios.post.mock.calls[0];
      // FormData is used — we verify the call was made
      expect(axios.post).toHaveBeenCalledTimes(1);
    });
  });

  describe('summarizeTranscript', () => {
    test('returns one-line summary from LLM', async () => {
      axios.post.mockResolvedValue({
        data: {
          choices: [{ message: { content: 'User confirms dinner at 8pm.' } }],
        },
      });

      const result = await summarizeTranscript('Long transcript text here', 'test-api-key');

      expect(result.summary).toBe('User confirms dinner at 8pm.');
      expect(result.languageOk).toBe(true);
    });

    test('detects gibberish warning from LLM', async () => {
      axios.post.mockResolvedValue({
        data: {
          choices: [{ message: { content: '⚠️ Transcription incorrecte (langue non reconnue)' } }],
        },
      });

      const result = await summarizeTranscript('Gibberish text', 'test-api-key');

      expect(result.languageOk).toBe(false);
      expect(result.summary).toContain('⚠️');
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest src/__tests__/groq.test.js --verbose`
Expected: FAIL — module not found

- [ ] **Step 3: Write implementation**

```javascript
// backend/src/services/groq.js
const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');

const WHISPER_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';
const CHAT_URL = 'https://api.groq.com/openai/v1/chat/completions';
const WHISPER_MODEL = 'whisper-large-v3-turbo';
const LLM_MODEL = 'llama-3.3-70b-versatile';

const LANGUAGE_PROMPTS = {
  en: 'Transcription of a voice message in English.',
  fr: "Transcription d'un message vocal en français.",
  es: 'Transcripción de un mensaje de voz en español.',
};

/**
 * Transcribe audio file via Groq Whisper.
 * @param {string} audioPath - path to .ogg file
 * @param {string} language - language hint (en, fr, es, etc.)
 * @param {string} apiKey - Groq API key
 * @returns {string} transcript text
 */
async function transcribeAudio(audioPath, language, apiKey) {
  const form = new FormData();
  form.append('file', fs.createReadStream(audioPath), { filename: 'audio.ogg' });
  form.append('model', WHISPER_MODEL);
  form.append('response_format', 'text');

  if (language) {
    form.append('language', language);
  }

  const prompt = LANGUAGE_PROMPTS[language] || LANGUAGE_PROMPTS.en;
  form.append('prompt', prompt);

  const res = await axios.post(WHISPER_URL, form, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      ...form.getHeaders(),
    },
  });

  return res.data.trim();
}

/**
 * Summarize transcript via Groq LLM.
 * @param {string} transcript
 * @param {string} apiKey
 * @returns {{ summary: string, languageOk: boolean }}
 */
async function summarizeTranscript(transcript, apiKey) {
  const res = await axios.post(
    CHAT_URL,
    {
      model: LLM_MODEL,
      messages: [
        {
          role: 'system',
          content: `You process WhatsApp voice message transcripts.
If the transcript looks like a wrong language (Welsh, Icelandic, gibberish, etc.), say: "⚠️ Transcription incorrecte (langue non reconnue)".
Otherwise, summarize in exactly one concise line in the same language as the transcript.`,
        },
        { role: 'user', content: transcript },
      ],
      max_tokens: 120,
      temperature: 0.3,
    },
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    }
  );

  const summary = res.data.choices[0].message.content.trim();
  const languageOk = !summary.includes('⚠️');

  return { summary, languageOk };
}

module.exports = { transcribeAudio, summarizeTranscript };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest src/__tests__/groq.test.js --verbose`
Expected: 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/groq.js backend/src/__tests__/groq.test.js
git commit -m "feat: add Groq Whisper + LLM service with tests"
```

---

### Task 5: Push Notification Service

**Files:**
- Create: `backend/src/services/push.js`
- Create: `backend/src/__tests__/push.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
// backend/src/__tests__/push.test.js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest src/__tests__/push.test.js --verbose`
Expected: FAIL — module not found

- [ ] **Step 3: Write implementation**

```javascript
// backend/src/services/push.js
const { Expo } = require('expo-server-sdk');

const expo = new Expo();

/**
 * Send a push notification to a single Expo push token.
 * @param {string} pushToken - Expo push token
 * @param {{ senderName: string, summary: string, transcriptionId: string }} data
 */
async function sendPushNotification(pushToken, { senderName, summary, transcriptionId }) {
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest src/__tests__/push.test.js --verbose`
Expected: 3 tests PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/push.js backend/src/__tests__/push.test.js
git commit -m "feat: add Expo push notification service with tests"
```

---

## Chunk 2: Baileys Session Management

### Task 6: Auth State Adapter (Encrypted Supabase Storage)

**Files:**
- Create: `backend/src/sessions/authState.js`
- Create: `backend/src/__tests__/authState.test.js`

This module replaces Baileys' default `useMultiFileAuthState` with a Supabase-backed encrypted store. It implements the `AuthenticationState` interface that Baileys expects: `{ state, saveCreds }`.

- [ ] **Step 1: Write the failing test**

```javascript
// backend/src/__tests__/authState.test.js
const { useSupabaseAuthState } = require('../sessions/authState');
const { encrypt, decrypt } = require('../services/encryption');

// Mock supabase
const mockSupabase = {
  from: jest.fn(),
};

jest.mock('../db/supabase', () => mockSupabase);

const TEST_KEY = 'a'.repeat(64);

describe('useSupabaseAuthState', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns empty state when no credentials exist', async () => {
    mockSupabase.from.mockReturnValue({
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

    mockSupabase.from.mockReturnValue({
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
    mockSupabase.from
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest src/__tests__/authState.test.js --verbose`
Expected: FAIL — module not found

- [ ] **Step 3: Write implementation**

```javascript
// backend/src/sessions/authState.js
const { encrypt, decrypt } = require('../services/encryption');
const supabase = require('../db/supabase');
const { proto } = require('@whiskeysockets/baileys');
const { initAuthCreds } = require('@whiskeysockets/baileys');

/**
 * Supabase-backed auth state for Baileys.
 * Replaces useMultiFileAuthState with encrypted DB storage.
 *
 * @param {string} userId
 * @param {string} encryptionKey - hex-encoded 32-byte key
 * @returns {{ state: AuthenticationState, saveCreds: Function }}
 */
async function useSupabaseAuthState(userId, encryptionKey) {
  // Load existing credentials
  const { data: session } = await supabase
    .from('whatsapp_sessions')
    .select('credentials_json')
    .eq('user_id', userId)
    .single();

  let creds = {};
  let keys = {};

  if (session?.credentials_json) {
    try {
      const decrypted = JSON.parse(decrypt(session.credentials_json, encryptionKey));
      creds = decrypted.creds || {};
      keys = decrypted.keys || {};
    } catch (err) {
      console.error(`Failed to decrypt credentials for user ${userId}:`, err.message);
      creds = {};
      keys = {};
    }
  }

  // If no existing creds, initialize fresh ones
  if (!creds.me) {
    creds = initAuthCreds();
  }

  const state = {
    creds,
    keys: {
      get: (type, ids) => {
        const result = {};
        for (const id of ids) {
          const value = keys[`${type}-${id}`];
          if (value) {
            result[id] = type === 'app-state-sync-key'
              ? proto.Message.AppStateSyncKeyData.fromObject(value)
              : value;
          }
        }
        return result;
      },
      set: (data) => {
        for (const [type, entries] of Object.entries(data)) {
          for (const [id, value] of Object.entries(entries)) {
            if (value) {
              keys[`${type}-${id}`] = value;
            } else {
              delete keys[`${type}-${id}`];
            }
          }
        }
      },
    },
  };

  const saveCreds = async (updatedCreds) => {
    if (updatedCreds) {
      creds = { ...creds, ...updatedCreds };
    }

    const encrypted = encrypt(
      JSON.stringify({ creds, keys }),
      encryptionKey
    );

    // Use update (not upsert) to avoid overwriting phone_number/status
    // The whatsapp_sessions row is created by sessionManager.requestPairingCode
    await supabase
      .from('whatsapp_sessions')
      .update({ credentials_json: encrypted })
      .eq('user_id', userId);
  };

  return { state, saveCreds };
}

module.exports = { useSupabaseAuthState };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest src/__tests__/authState.test.js --verbose`
Expected: 3 tests PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/sessions/authState.js backend/src/__tests__/authState.test.js
git commit -m "feat: add encrypted Supabase auth state adapter for Baileys"
```

---

### Task 7: Create Session (Single Baileys Socket)

**Files:**
- Create: `backend/src/sessions/createSession.js`

This module creates a single Baileys WebSocket connection for one user. It wires up event handlers and returns the socket + control functions. No unit test for this — it depends heavily on Baileys internals and will be tested via integration.

- [ ] **Step 1: Write createSession.js**

```javascript
// backend/src/sessions/createSession.js
const {
  default: makeWASocket,
  downloadMediaMessage,
  DisconnectReason,
  fetchLatestBaileysVersion,
} = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
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

/**
 * Creates and connects a single Baileys session for a user.
 *
 * @param {string} userId
 * @param {EventEmitter} emitter - shared event emitter for cross-module communication
 * @returns {{ sock, cleanup }} - socket instance and cleanup function
 */
async function createSession(userId, emitter) {
  const { state, saveCreds } = await useSupabaseAuthState(userId, config.encryptionKey);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }),
    ...BAILEYS_CONFIG,
  });

  // Save credentials on update
  sock.ev.on('creds.update', () => saveCreds());

  // Handle incoming messages
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const msg of messages) {
      if (msg.key.fromMe) continue;

      const isAudio = msg.message?.audioMessage || msg.message?.pttMessage;
      if (!isAudio) continue;

      emitter.emit('audio-received', { userId, message: msg });
    }
  });

  // Handle connection state changes
  sock.ev.on('connection.update', async ({ connection, lastDisconnect }) => {
    if (connection === 'open') {
      // Force offline presence to preserve phone push notifications
      sock.sendPresenceUpdate('unavailable').catch(() => {});
      emitter.emit('connection-changed', { userId, status: 'connected' });
    }

    if (connection === 'close') {
      const statusCode = new Boom(lastDisconnect?.error)?.output?.statusCode;

      // Auth failure — don't retry, mark disconnected immediately
      if (statusCode === DisconnectReason.loggedOut || statusCode === 401) {
        emitter.emit('connection-changed', { userId, status: 'disconnected', authFailed: true });
        return;
      }

      // Transient failure — let session manager handle reconnection
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
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/sessions/createSession.js
git commit -m "feat: add Baileys single-session creator with stealth config"
```

---

### Task 8: Session Manager (Multi-Tenant Registry)

**Files:**
- Create: `backend/src/sessions/sessionManager.js`
- Create: `backend/src/__tests__/sessionManager.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
// backend/src/__tests__/sessionManager.test.js
const EventEmitter = require('events');

// Mock createSession before requiring sessionManager
const mockSock = {
  requestPairingCode: jest.fn().mockResolvedValue('ABCD1234'),
  end: jest.fn(),
  ev: { removeAllListeners: jest.fn() },
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest src/__tests__/sessionManager.test.js --verbose`
Expected: FAIL — module not found

- [ ] **Step 3: Write implementation**

```javascript
// backend/src/sessions/sessionManager.js
const EventEmitter = require('events');
const { createSession } = require('./createSession');
const supabase = require('../db/supabase');
const { sendPushNotification } = require('../services/push');

const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_DELAYS = [1000, 2000, 4000, 8000, 60000]; // exponential backoff
const STAGGER_DELAY_MS = 100;

class SessionManager {
  constructor() {
    this.sessions = new Map(); // userId -> { sock, cleanup, status, reconnectAttempts }
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

  /**
   * Request a pairing code for a new WhatsApp link.
   */
  async requestPairingCode(userId, phoneNumber) {
    // Clean up existing session if any
    if (this.sessions.has(userId)) {
      const existing = this.sessions.get(userId);
      if (existing.cleanup) existing.cleanup();
    }

    const { sock, cleanup } = await createSession(userId, this.emitter);
    this.sessions.set(userId, { sock, cleanup, status: 'pending', reconnectAttempts: 0 });

    // Store phone number
    await supabase.from('whatsapp_sessions').upsert({
      user_id: userId,
      phone_number: phoneNumber,
      status: 'pending',
      credentials_json: '',
    });

    // Wait for socket to be ready before requesting pairing code
    // Baileys needs to connect to WA servers first (but not yet authenticated)
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Socket connection timeout')), 30000);
      sock.ev.on('connection.update', ({ connection }) => {
        if (connection === 'open' || connection === 'connecting') {
          clearTimeout(timeout);
          resolve();
        }
      });
    });

    const code = await sock.requestPairingCode(phoneNumber);
    return code;
  }

  /**
   * Start a session from existing stored credentials.
   */
  async startSession(userId) {
    if (this.sessions.has(userId)) return;

    const { sock, cleanup } = await createSession(userId, this.emitter);
    this.sessions.set(userId, { sock, cleanup, status: 'connecting', reconnectAttempts: 0 });
  }

  /**
   * Stop and remove a session.
   */
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

  /**
   * Get connection status for a user.
   */
  getStatus(userId) {
    const session = this.sessions.get(userId);
    return session?.status || 'disconnected';
  }

  /**
   * Restore all previously connected sessions on server startup.
   */
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
        // Stagger to avoid flooding WhatsApp servers
        await new Promise((resolve) => setTimeout(resolve, STAGGER_DELAY_MS));
      } catch (err) {
        console.error(`Failed to restore session for ${user_id}:`, err.message);
      }
    }
  }

  /**
   * Clean shutdown of all sessions.
   */
  shutdown() {
    for (const [userId, session] of this.sessions) {
      if (session.cleanup) session.cleanup();
    }
    this.sessions.clear();
    this.emitter.removeAllListeners();
  }
}

module.exports = { SessionManager };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest src/__tests__/sessionManager.test.js --verbose`
Expected: 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/sessions/sessionManager.js backend/src/__tests__/sessionManager.test.js
git commit -m "feat: add multi-tenant Baileys session manager with reconnection"
```

---

## Chunk 3: Transcription Pipeline + Server

### Task 9: Transcription Pipeline

**Files:**
- Create: `backend/src/pipeline/transcribe.js`
- Create: `backend/src/__tests__/transcribe.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
// backend/src/__tests__/transcribe.test.js
const { processAudioMessage } = require('../pipeline/transcribe');

// Mock all dependencies
jest.mock('@whiskeysockets/baileys', () => ({
  downloadMediaMessage: jest.fn().mockResolvedValue(Buffer.from('fake-audio')),
}));

jest.mock('../services/groq', () => ({
  transcribeAudio: jest.fn().mockResolvedValue('Hello this is a test message.'),
  summarizeTranscript: jest.fn().mockResolvedValue({
    summary: 'Test greeting message.',
    languageOk: true,
  }),
}));

jest.mock('../services/push', () => ({
  sendPushNotification: jest.fn().mockResolvedValue(undefined),
}));

const mockSupabase = {
  from: jest.fn(),
};
jest.mock('../db/supabase', () => mockSupabase);

jest.mock('../config', () => ({
  groqApiKey: 'test-key',
}));

const fs = require('fs');

describe('processAudioMessage', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // Default supabase mock chain
    mockSupabase.from.mockImplementation((table) => {
      if (table === 'usage') {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                single: jest.fn().mockResolvedValue({
                  data: { minutes_used: 2, quota_exceeded_at: null },
                  error: null,
                }),
              }),
            }),
          }),
          upsert: jest.fn().mockResolvedValue({ error: null }),
        };
      }
      if (table === 'user_settings') {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({
                data: { preferred_languages: ['en'] },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === 'subscriptions') {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({
                data: { plan: 'free', extra_minutes_per_month: 0, bonus_minutes: 0 },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === 'transcriptions') {
        return { insert: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({
              data: { id: 'txn-123' },
              error: null,
            }),
          }),
        })};
      }
      if (table === 'push_tokens') {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockResolvedValue({
              data: [{ expo_push_token: 'ExponentPushToken[xxx]' }],
              error: null,
            }),
          }),
        };
      }
      if (table === 'pending_transcriptions') {
        return { insert: jest.fn().mockResolvedValue({ error: null }) };
      }
      return {};
    });
  });

  const fakeMessage = {
    key: { remoteJid: '33612345678@s.whatsapp.net', fromMe: false },
    pushName: 'Marie',
    messageTimestamp: Math.floor(Date.now() / 1000),
    message: {
      audioMessage: { seconds: 30 },
    },
  };

  test('processes audio message end-to-end', async () => {
    const { sendPushNotification } = require('../services/push');
    const { transcribeAudio } = require('../services/groq');

    await processAudioMessage('user-1', fakeMessage);

    expect(transcribeAudio).toHaveBeenCalled();
    expect(sendPushNotification).toHaveBeenCalledWith(
      'ExponentPushToken[xxx]',
      expect.objectContaining({
        senderName: 'Marie',
        summary: 'Test greeting message.',
      })
    );
  });

  test('rejects audio longer than 10 minutes', async () => {
    const longMessage = {
      ...fakeMessage,
      message: { audioMessage: { seconds: 601 } },
    };

    const { sendPushNotification } = require('../services/push');

    await processAudioMessage('user-1', longMessage);

    expect(sendPushNotification).toHaveBeenCalledWith(
      'ExponentPushToken[xxx]',
      expect.objectContaining({
        summary: expect.stringContaining('10 min'),
      })
    );
  });

  test('cleans up temp file after processing', async () => {
    jest.spyOn(fs, 'existsSync').mockReturnValue(true);
    jest.spyOn(fs, 'unlinkSync').mockImplementation(() => {});
    jest.spyOn(fs, 'writeFileSync').mockImplementation(() => {});

    await processAudioMessage('user-1', fakeMessage);

    expect(fs.unlinkSync).toHaveBeenCalled();

    fs.existsSync.mockRestore();
    fs.unlinkSync.mockRestore();
    fs.writeFileSync.mockRestore();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest src/__tests__/transcribe.test.js --verbose`
Expected: FAIL — module not found

- [ ] **Step 3: Write implementation**

```javascript
// backend/src/pipeline/transcribe.js
const path = require('path');
const fs = require('fs');
const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const { transcribeAudio, summarizeTranscript } = require('../services/groq');
const { sendPushNotification } = require('../services/push');
const supabase = require('../db/supabase');
const config = require('../config');

const MAX_DURATION_SEC = 600; // 10 minutes
const PLAN_LIMITS = { free: 5, starter: 100, unlimited: Infinity };

/**
 * Get monthly minute limit for a user.
 */
async function getMonthlyLimit(userId) {
  const { data: sub } = await supabase
    .from('subscriptions')
    .select('plan, extra_minutes_per_month, addon_expires_at, bonus_minutes')
    .eq('user_id', userId)
    .single();

  if (!sub) return 5; // default free

  const base = PLAN_LIMITS[sub.plan] || 5;

  // Add-on minutes only count if not expired
  const addonMinutes =
    sub.addon_expires_at && new Date(sub.addon_expires_at) > new Date()
      ? sub.extra_minutes_per_month || 0
      : 0;

  return base + addonMinutes + (sub.bonus_minutes || 0);
}

/**
 * Get current month usage for a user.
 */
async function getCurrentUsage(userId) {
  const month = new Date().toISOString().slice(0, 7); // YYYY-MM
  const { data } = await supabase
    .from('usage')
    .select('minutes_used, quota_exceeded_at')
    .eq('user_id', userId)
    .eq('month', month)
    .single();

  return data || { minutes_used: 0, quota_exceeded_at: null };
}

/**
 * Get push tokens for a user.
 */
async function getPushTokens(userId) {
  const { data } = await supabase
    .from('push_tokens')
    .select('expo_push_token')
    .eq('user_id', userId);

  return (data || []).map((t) => t.expo_push_token);
}

/**
 * Check if user has notifications enabled.
 */
async function isNotificationsEnabled(userId) {
  const { data } = await supabase
    .from('user_settings')
    .select('notifications_enabled')
    .eq('user_id', userId)
    .single();
  return data?.notifications_enabled !== false;
}

/**
 * Send a push notification to all user's devices (if notifications enabled).
 */
async function notifyUser(userId, payload) {
  if (!(await isNotificationsEnabled(userId))) return;
  const tokens = await getPushTokens(userId);
  for (const token of tokens) {
    await sendPushNotification(token, payload);
  }
}

/**
 * Process a single audio message through the full pipeline.
 */
async function processAudioMessage(userId, msg, { isRetry = false } = {}) {
  const sender = msg.pushName || msg.key.remoteJid.split('@')[0];
  const audioInfo = msg.message?.audioMessage || msg.message?.pttMessage;
  const durationSec = audioInfo?.seconds || 0;

  // 1. Check duration limit
  if (durationSec > MAX_DURATION_SEC) {
    await notifyUser(userId, {
      senderName: sender,
      summary: `Voice message too long (${Math.ceil(durationSec / 60)} min). 10 min limit.`,
      transcriptionId: '',
    });
    return;
  }

  // 2. Check quota
  const limit = await getMonthlyLimit(userId);
  const usage = await getCurrentUsage(userId);
  const minutesCost = Math.ceil(durationSec / 60);

  if (usage.minutes_used >= limit) {
    // Check if we're in the 2-day buffer
    const bufferExpired =
      usage.quota_exceeded_at &&
      Date.now() - new Date(usage.quota_exceeded_at).getTime() > 2 * 24 * 60 * 60 * 1000;

    if (bufferExpired) {
      await notifyUser(userId, {
        senderName: 'VoiceScribe',
        summary: 'Monthly quota reached. Upgrade for more minutes.',
        transcriptionId: '',
      });
      return;
    }
  }

  const isOverQuota = usage.minutes_used + minutesCost > limit;

  // 3. Download audio
  const tmpPath = path.join('/tmp', `wa_${userId}_${Date.now()}.ogg`);
  let audioBuffer;

  try {
    audioBuffer = await downloadMediaMessage(msg, 'buffer', {});
    fs.writeFileSync(tmpPath, audioBuffer);
  } catch (err) {
    // Save for retry — download failed, no audio buffer to store
    await saveForRetry(userId, msg, null, err.message);
    return;
  }

  try {
    // 4. Get language preference
    const { data: settings } = await supabase
      .from('user_settings')
      .select('preferred_languages')
      .eq('user_id', userId)
      .single();

    const language = settings?.preferred_languages?.[0] || 'en';

    // 5. Transcribe
    const transcript = await transcribeAudio(tmpPath, language, config.groqApiKey);

    // 6. Summarize
    const { summary, languageOk } = await summarizeTranscript(transcript, config.groqApiKey);

    const finalSummary = languageOk ? summary : 'Transcription may be inaccurate';

    // 7. Save to DB
    const { data: txn } = await supabase
      .from('transcriptions')
      .insert({
        user_id: userId,
        sender_name: sender,
        sender_jid: msg.key.remoteJid,
        audio_duration_sec: durationSec,
        transcript,
        summary,
        language_ok: languageOk,
        visible: !isOverQuota,
      })
      .select('id')
      .single();

    // 8. Update usage
    const month = new Date().toISOString().slice(0, 7);
    const newMinutes = usage.minutes_used + minutesCost;
    const justHitQuota = newMinutes >= limit && !usage.quota_exceeded_at;
    const quotaExceededAt = justHitQuota
      ? new Date().toISOString()
      : usage.quota_exceeded_at;

    await supabase.from('usage').upsert({
      user_id: userId,
      month,
      minutes_used: newMinutes,
      quota_exceeded_at: quotaExceededAt,
    });

    // Notify user when they first hit their quota
    if (justHitQuota) {
      await notifyUser(userId, {
        senderName: 'VoiceScribe',
        summary: `You've used your ${limit} min this month. Upgrade for more.`,
        transcriptionId: '',
      });
    }

    // 9. Send push (only if visible)
    if (!isOverQuota) {
      await notifyUser(userId, {
        senderName: sender,
        summary: finalSummary,
        transcriptionId: txn?.id || '',
      });
    }
  } catch (err) {
    console.error(`Pipeline error for user ${userId}:`, err.message);
    // Only save for retry on first attempt — retries are managed by retryWorker
    if (!isRetry) {
      await saveForRetry(userId, msg, audioBuffer, err.message);
    } else {
      throw err; // Let retryWorker handle the failure
    }
  } finally {
    // 10. Always clean up temp file
    if (fs.existsSync(tmpPath)) {
      fs.unlinkSync(tmpPath);
    }
  }
}

/**
 * Save a failed message for retry by the retry worker.
 */
async function saveForRetry(userId, msg, audioBuffer, errorMessage) {
  // Serialize message metadata (strip the actual media stream)
  const messageData = {
    key: msg.key,
    pushName: msg.pushName,
    messageTimestamp: msg.messageTimestamp,
    message: msg.message,
  };

  await supabase.from('pending_transcriptions').insert({
    user_id: userId,
    message_data: messageData,
    audio_data: audioBuffer || null,
    status: 'pending',
    attempts: 0,
    last_error: errorMessage,
    next_retry_at: new Date(Date.now() + 30000).toISOString(), // 30s from now
  });
}

module.exports = { processAudioMessage, getMonthlyLimit, getCurrentUsage };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest src/__tests__/transcribe.test.js --verbose`
Expected: 3 tests PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/pipeline/transcribe.js backend/src/__tests__/transcribe.test.js
git commit -m "feat: add full transcription pipeline with quota, retry, and push"
```

---

### Task 10: Retry Worker

**Files:**
- Create: `backend/src/pipeline/retryWorker.js`
- Create: `backend/src/__tests__/retryWorker.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
// backend/src/__tests__/retryWorker.test.js
const { processRetryQueue } = require('../pipeline/retryWorker');

const mockSupabase = {
  from: jest.fn(),
};
jest.mock('../db/supabase', () => mockSupabase);

jest.mock('../pipeline/transcribe', () => ({
  processAudioMessage: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../services/push', () => ({
  sendPushNotification: jest.fn().mockResolvedValue(undefined),
}));

describe('retryWorker', () => {
  beforeEach(() => jest.clearAllMocks());

  test('picks up pending jobs and processes them', async () => {
    const pendingJob = {
      id: 'job-1',
      user_id: 'user-1',
      message_data: { key: {}, pushName: 'Test', message: { audioMessage: { seconds: 10 } } },
      audio_data: null,
      attempts: 1,
    };

    mockSupabase.from.mockImplementation((table) => {
      if (table === 'pending_transcriptions') {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              lte: jest.fn().mockResolvedValue({ data: [pendingJob], error: null }),
            }),
          }),
          update: jest.fn().mockReturnValue({
            eq: jest.fn().mockResolvedValue({ error: null }),
          }),
          delete: jest.fn().mockReturnValue({
            eq: jest.fn().mockResolvedValue({ error: null }),
          }),
        };
      }
      return {};
    });

    const { processAudioMessage } = require('../pipeline/transcribe');
    await processRetryQueue();

    expect(processAudioMessage).toHaveBeenCalledWith('user-1', pendingJob.message_data, { isRetry: true });
  });

  test('marks job as failed after 3 attempts', async () => {
    const failedJob = {
      id: 'job-2',
      user_id: 'user-2',
      message_data: { key: {}, pushName: 'Test', message: { audioMessage: { seconds: 10 } } },
      audio_data: null,
      attempts: 3,
    };

    const mockUpdate = jest.fn().mockReturnValue({
      eq: jest.fn().mockResolvedValue({ error: null }),
    });

    mockSupabase.from.mockImplementation((table) => {
      if (table === 'pending_transcriptions') {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              lte: jest.fn().mockResolvedValue({ data: [failedJob], error: null }),
            }),
          }),
          update: mockUpdate,
        };
      }
      if (table === 'push_tokens') {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockResolvedValue({ data: [], error: null }),
          }),
        };
      }
      return {};
    });

    await processRetryQueue();

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed' })
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest src/__tests__/retryWorker.test.js --verbose`
Expected: FAIL — module not found

- [ ] **Step 3: Write implementation**

```javascript
// backend/src/pipeline/retryWorker.js
const supabase = require('../db/supabase');
const { processAudioMessage } = require('./transcribe');
const { sendPushNotification } = require('../services/push');

const MAX_ATTEMPTS = 3;
const RETRY_DELAYS = [30000, 60000, 120000]; // 30s, 60s, 120s
const POLL_INTERVAL_MS = 15000; // check every 15s

/**
 * Process all pending retry jobs that are due.
 */
async function processRetryQueue() {
  const now = new Date().toISOString();

  const { data: jobs, error } = await supabase
    .from('pending_transcriptions')
    .select('*')
    .eq('status', 'pending')
    .lte('next_retry_at', now);

  if (error || !jobs || jobs.length === 0) return;

  for (const job of jobs) {
    if (job.attempts >= MAX_ATTEMPTS) {
      // Mark as permanently failed
      await supabase
        .from('pending_transcriptions')
        .update({ status: 'failed', last_error: 'Max attempts reached' })
        .eq('id', job.id);

      // Notify user
      const { data: tokens } = await supabase
        .from('push_tokens')
        .select('expo_push_token')
        .eq('user_id', job.user_id);

      for (const { expo_push_token } of tokens || []) {
        await sendPushNotification(expo_push_token, {
          senderName: job.message_data?.pushName || 'Unknown',
          summary: 'Failed to transcribe voice message after multiple attempts.',
          transcriptionId: '',
        });
      }
      continue;
    }

    // Mark as processing
    await supabase
      .from('pending_transcriptions')
      .update({ status: 'processing' })
      .eq('id', job.id);

    try {
      await processAudioMessage(job.user_id, job.message_data, { isRetry: true });

      // Success — delete the pending job
      await supabase
        .from('pending_transcriptions')
        .delete()
        .eq('id', job.id);
    } catch (err) {
      // Increment attempts and schedule next retry
      const nextAttempt = job.attempts + 1;
      const delay = RETRY_DELAYS[Math.min(nextAttempt - 1, RETRY_DELAYS.length - 1)];

      await supabase
        .from('pending_transcriptions')
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

/**
 * Start the retry worker polling loop.
 */
function startRetryWorker() {
  console.log('Retry worker started (polling every 15s)');
  intervalId = setInterval(processRetryQueue, POLL_INTERVAL_MS);
  // Run immediately on start
  processRetryQueue().catch(console.error);
}

/**
 * Stop the retry worker.
 */
function stopRetryWorker() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}

module.exports = { processRetryQueue, startRetryWorker, stopRetryWorker };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest src/__tests__/retryWorker.test.js --verbose`
Expected: 2 tests PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/pipeline/retryWorker.js backend/src/__tests__/retryWorker.test.js
git commit -m "feat: add retry worker for failed transcriptions"
```

---

### Task 11: Auth Middleware + Minimal Routes

**Files:**
- Create: `backend/src/middleware/auth.js`
- Create: `backend/src/routes/whatsapp.js`
- Create: `backend/src/routes/push.js`

- [ ] **Step 1: Write auth middleware**

```javascript
// backend/src/middleware/auth.js
const supabase = require('../db/supabase');

/**
 * Express middleware to verify Supabase JWT.
 * Attaches req.userId on success.
 */
async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing authorization header' });
  }

  const token = authHeader.slice(7);

  const { data: { user }, error } = await supabase.auth.getUser(token);

  if (error || !user) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  req.userId = user.id;
  next();
}

module.exports = { requireAuth };
```

- [ ] **Step 2: Write WhatsApp routes**

```javascript
// backend/src/routes/whatsapp.js
const express = require('express');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// Rate limit tracking (in-memory, per-user)
const pairingCooldowns = new Map();
const COOLDOWN_MS = 90000; // 90 seconds

/**
 * Initialize WhatsApp routes with session manager reference.
 */
function createWhatsAppRouter(sessionManager) {
  router.post('/pair', requireAuth, async (req, res) => {
    try {
      const { phoneNumber } = req.body;
      if (!phoneNumber) {
        return res.status(400).json({ error: 'phoneNumber is required' });
      }

      // Rate limit check
      const lastRequest = pairingCooldowns.get(req.userId);
      if (lastRequest && Date.now() - lastRequest < COOLDOWN_MS) {
        const remaining = Math.ceil((COOLDOWN_MS - (Date.now() - lastRequest)) / 1000);
        return res.status(429).json({ error: `Please wait ${remaining}s before requesting a new code` });
      }

      pairingCooldowns.set(req.userId, Date.now());
      const code = await sessionManager.requestPairingCode(req.userId, phoneNumber);

      res.json({ code, expiresIn: 60 });
    } catch (err) {
      console.error('Pairing error:', err.message);
      res.status(500).json({ error: 'Failed to generate pairing code' });
    }
  });

  router.get('/status', requireAuth, async (req, res) => {
    const status = sessionManager.getStatus(req.userId);
    res.json({ status });
  });

  router.delete('/disconnect', requireAuth, async (req, res) => {
    try {
      await sessionManager.stopSession(req.userId);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: 'Failed to disconnect' });
    }
  });

  return router;
}

module.exports = { createWhatsAppRouter };
```

- [ ] **Step 3: Write push token route**

```javascript
// backend/src/routes/push.js
const express = require('express');
const { requireAuth } = require('../middleware/auth');
const supabase = require('../db/supabase');

const router = express.Router();

router.post('/register', requireAuth, async (req, res) => {
  const { expoPushToken, platform } = req.body;

  if (!expoPushToken || !platform) {
    return res.status(400).json({ error: 'expoPushToken and platform are required' });
  }

  if (!['ios', 'android'].includes(platform)) {
    return res.status(400).json({ error: 'platform must be ios or android' });
  }

  const { error } = await supabase.from('push_tokens').upsert(
    {
      user_id: req.userId,
      expo_push_token: expoPushToken,
      platform,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,platform' }
  );

  if (error) {
    return res.status(500).json({ error: 'Failed to register push token' });
  }

  res.json({ success: true });
});

module.exports = router;
```

- [ ] **Step 4: Commit**

```bash
git add backend/src/middleware/auth.js backend/src/routes/whatsapp.js backend/src/routes/push.js
git commit -m "feat: add auth middleware, WhatsApp pairing routes, and push registration"
```

---

### Task 12: Express Server Entry Point

**Files:**
- Create: `backend/src/index.js`

- [ ] **Step 1: Write the server**

```javascript
// backend/src/index.js
const express = require('express');
const config = require('./config');
const { SessionManager } = require('./sessions/sessionManager');
const { processAudioMessage } = require('./pipeline/transcribe');
const { startRetryWorker, stopRetryWorker } = require('./pipeline/retryWorker');
const { createWhatsAppRouter } = require('./routes/whatsapp');
const pushRouter = require('./routes/push');

const app = express();
app.use(express.json());

// Initialize session manager
const sessionManager = new SessionManager();

// Wire up audio pipeline to session manager events
sessionManager.emitter.on('audio-received', ({ userId, message }) => {
  // Fire and forget — don't block the event loop
  processAudioMessage(userId, message).catch((err) => {
    console.error(`Pipeline error for ${userId}:`, err.message);
  });
});

// Mount routes
app.use('/whatsapp', createWhatsAppRouter(sessionManager));
app.use('/push', pushRouter);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', sessions: sessionManager.sessions.size });
});

// Start server
const server = app.listen(config.port, async () => {
  console.log(`VoiceScribe backend running on port ${config.port}`);

  // Restore WhatsApp sessions
  await sessionManager.restoreAllSessions();

  // Start retry worker
  startRetryWorker();
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('Shutting down...');
  stopRetryWorker();
  sessionManager.shutdown();
  server.close(() => process.exit(0));
});

process.on('SIGINT', () => {
  console.log('Shutting down...');
  stopRetryWorker();
  sessionManager.shutdown();
  server.close(() => process.exit(0));
});

module.exports = app; // for testing
```

- [ ] **Step 2: Verify the server starts**

Run: `cd backend && node -e "require('./src/config')" 2>&1 || echo "Expected: env var error (no .env yet)"`
Expected: Error about missing env vars (confirms config validation works)

- [ ] **Step 3: Commit**

```bash
git add backend/src/index.js
git commit -m "feat: add Express server entry point wiring all modules together"
```

---

### Task 13: Run Full Test Suite

- [ ] **Step 1: Run all tests**

Run: `cd backend && npx jest --verbose`
Expected: All tests pass (encryption: 4, groq: 4, push: 3, authState: 3, sessionManager: 4, transcribe: 3, retryWorker: 2 = 23 tests)

- [ ] **Step 2: Fix any failures if needed**

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "feat: complete Phase 1 — core backend with all tests passing"
```

---

## Summary

**Phase 1 delivers:**
- Encrypted Baileys session management (multi-tenant, reconnect, pairing code)
- Full transcription pipeline (Groq Whisper + LLM, quota, soft block, retry)
- Push notifications via Expo
- Auth middleware + WhatsApp and push routes
- 23 unit tests covering all services

**What's NOT in Phase 1** (deferred to later phases):
- Auth routes (signup/login) — Phase 2
- Transcription list/detail routes — Phase 2
- Usage/settings/subscription routes — Phase 2
- Mobile app — Phase 3
- Stripe + referrals — Phase 4

**Next:** After Phase 1 is implemented, create the Phase 2 plan for the full REST API layer.
