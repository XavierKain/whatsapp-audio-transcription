# VoiceScribe — Design Document

**Date:** 2026-03-18
**Status:** Approved
**Scope:** Full-stack mobile app — WhatsApp voice message transcription with push notifications

---

## Overview

VoiceScribe automatically transcribes incoming WhatsApp voice messages and delivers them as push notifications. Users connect their WhatsApp account via a pairing code, and the backend listens passively for audio messages, transcribes them via Groq Whisper, generates a one-line summary, and sends a push notification. Senders see nothing unusual — no read receipts, no typing indicators, no online status change.

## Tech Stack

| Layer | Technology |
|---|---|
| Mobile app | React Native (Expo) — iOS + Android |
| Backend | Node.js + Express (single monolith) |
| WhatsApp connection | @whiskeysockets/baileys (multi-tenant, one WebSocket per user) |
| Transcription | Groq API — whisper-large-v3-turbo |
| Summarization | Groq API — llama-3.3-70b-versatile |
| Push notifications | Expo Push Notifications (FCM + APNs) |
| Auth | Supabase Auth (email/password) |
| Database | Supabase (PostgreSQL) |
| Payments | Stripe |

## Architecture

Single Express monolith handling API routes, Baileys sessions, transcription pipeline, and push delivery. One process, one deploy.

The session manager is designed as an isolated module with a clean interface, ready for extraction into a separate worker process if scaling requires it (>1000 users). Migration path: replace in-memory EventEmitter with Redis pub/sub, extract to separate process. Estimated effort: 1-2 days.

### Key Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Architecture | Monolith Express | Simplest to build/debug/deploy, sufficient for 0-1000 users |
| WhatsApp pairing | Pairing code only (no QR in app) | Users can't scan a QR code displayed on the same phone |
| Credential storage | AES-256-GCM encrypted in Supabase | Protects credentials at rest without Supabase Vault dependency |
| Pipeline failures | Retry queue (3 attempts, exponential backoff) | Silent failures risk missing messages; retries balance reliability and simplicity |
| Audio limit | 10 minutes max per message | Avoids edge cases with Groq file size limits; can be raised later |
| Languages | EN/FR/ES at launch, user-selectable preferred languages | Whisper hint improves accuracy; multilingual as future premium feature |
| Push token timing | Register at signup, transcriptions only after pairing | Flexibility for system notifications without spamming pre-pairing |
| Pricing model | Freemium (5 min/month free) instead of time-limited trial | Voice messages depend on external events; trial may expire before user sees value |
| Post-quota behavior | Soft block + 2-day buffer (transcriptions saved but hidden) | Creates conversion incentive without losing messages |

---

## Project Structure

```
/backend
  /src
    /sessions
      sessionManager.js    — registry: start/stop/reconnect all sessions
      createSession.js     — init one Baileys socket, wire up event handlers
      authState.js         — load/save encrypted credentials from Supabase
    /pipeline
      transcribe.js        — download audio → quota check → Groq Whisper → Groq LLM → save
      retryWorker.js       — polls pending_transcriptions, retries failed jobs
    /routes
      auth.js              — signup, login (proxies to Supabase Auth)
      whatsapp.js          — POST /pair, GET /status, DELETE /disconnect
      transcriptions.js    — GET list, GET detail
      usage.js             — GET current usage
      subscription.js      — GET plan, POST upgrade
      push.js              — POST register token
      referral.js          — GET user's referral code
      settings.js          — GET/PUT user settings (languages, notifications)
      webhooks.js          — POST /webhooks/stripe
    /services
      groq.js              — Whisper + LLM API calls
      push.js              — Expo push notification sender
      stripe.js            — checkout session, webhook handlers
      encryption.js        — AES-256-GCM encrypt/decrypt
    /db
      supabase.js          — client init + query helpers
    /middleware
      auth.js              — verify Supabase JWT on protected routes
    index.js               — Express app, mount routes, start session manager
  package.json

/mobile
  /src
    /screens
      Onboarding.js        — signup/login
      PairingCode.js       — enter phone, display code, countdown, poll status
      Home.js              — transcription feed
      TranscriptionDetail.js
      Settings.js          — language prefs, connection status, notif prefs
      Upgrade.js           — plans, add-ons, referral
    /components
      TranscriptionCard.js
      UsageBanner.js
    /services
      api.js               — axios/fetch wrapper for all backend calls
      notifications.js     — Expo push token registration
    /i18n
      en.json, fr.json, es.json
    /navigation
      AppNavigator.js
  App.js
  app.json
```

---

## Database Schema

```sql
-- Core tables
users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE NOT NULL,
  created_at timestamptz DEFAULT now(),
  referral_code text UNIQUE NOT NULL,
  referred_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL
)

subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  plan text NOT NULL DEFAULT 'free',       -- free | starter | unlimited
  status text NOT NULL DEFAULT 'active',   -- active | cancelled | expired
  expires_at timestamptz,
  extra_minutes_per_month int DEFAULT 0,   -- from add-on purchases
  addon_expires_at timestamptz,            -- add-ons valid until this date
  bonus_minutes int DEFAULT 0,             -- from referrals (permanent)
  stripe_customer_id text,
  stripe_subscription_id text,
  is_early_adopter boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
)

whatsapp_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  credentials_json text NOT NULL,          -- AES-256-GCM encrypted
  phone_number text NOT NULL,
  status text NOT NULL DEFAULT 'pending',  -- pending | connected | disconnected
  last_connected_at timestamptz
)

transcriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  sender_name text,
  sender_jid text,
  audio_duration_sec int,
  transcript text,
  summary text,
  language_ok boolean DEFAULT true,
  visible boolean DEFAULT true,            -- false when saved during soft block
  created_at timestamptz DEFAULT now()
)

usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  month text NOT NULL,                     -- YYYY-MM format
  minutes_used int DEFAULT 0,
  quota_exceeded_at timestamptz,           -- when limit was first hit (starts 2-day buffer)
  UNIQUE(user_id, month)
)

push_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  expo_push_token text NOT NULL,
  platform text NOT NULL,                  -- ios | android
  updated_at timestamptz DEFAULT now(),
  UNIQUE(user_id, platform)                -- upsert on register, one token per platform
)

referrals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  referred_user_id uuid UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  bonus_applied_at timestamptz
)

-- Added during brainstorming
pending_transcriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  message_data jsonb NOT NULL,             -- serialized Baileys message metadata for retry
  audio_data bytea,                        -- stored audio buffer if download succeeded before failure
  status text NOT NULL DEFAULT 'pending',  -- pending | processing | failed
  attempts int DEFAULT 0,
  last_error text,
  next_retry_at timestamptz,
  created_at timestamptz DEFAULT now()
)

user_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  preferred_languages text[] DEFAULT '{en}',
  notifications_enabled boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
)
```

---

## Baileys Session Manager

### Public Interface

```
startSession(userId)                        → loads credentials, opens WebSocket
stopSession(userId)                         → closes WebSocket cleanly
getStatus(userId)                           → connected | disconnected | pending
requestPairingCode(userId, phoneNumber)     → returns 8-digit code
```

Events (via EventEmitter, global for all users — each event includes userId):

- `audio-received`    → { userId, message }
- `connection-changed` → { userId, status }

This EventEmitter pattern allows multiple consumers (pipeline, logging) and can be swapped for Redis pub/sub when extracting to a separate worker.

### Session Lifecycle

1. **First pairing:** `requestPairingCode()` creates a temporary Baileys socket, calls `sock.requestPairingCode(phone)`, returns the code, waits for `connection.update` with `connection: 'open'`
2. **Credentials saved:** on `open`, encrypt with AES-256-GCM and store in `whatsapp_sessions.credentials_json`
3. **Passive listening:** socket stays open with stealth config, listens to `messages.upsert`, filters for `audioMessage` or `pttMessage`
4. **Disconnect handling:** auto-reconnect with exponential backoff (1s, 2s, 4s, 8s, max 60s). After 5 consecutive failures → status `disconnected`, push notification to user. If the failure is an immediate auth error (credentials revoked, phone banned/reset), skip retries and go straight to `disconnected` + push notification.
5. **Server restart:** load all users with `status = 'connected'` from Supabase, decrypt credentials, reconnect sequentially with ~100ms stagger between sessions. Sessions that fail auth on reconnect are marked `disconnected` immediately.

### Baileys Configuration (validated on existing setup)

```javascript
{
  browser: ['Mac OS', 'Desktop', '10.15.7'],  // Appear as Desktop, not WEB_BROWSER
  syncFullHistory: false,
  markOnlineOnConnect: false,
  generateHighQualityLinkPreview: false,
  keepAliveIntervalMs: 30000,
}
```

Post-connection: `sock.sendPresenceUpdate('unavailable')` to force offline presence.

No read receipts sent, no presence updates, no typing indicators.

---

## Transcription Pipeline

```
Audio received (Baileys messages.upsert)
  │
  ├─ Filter: audioMessage || pttMessage, !fromMe
  │
  ▼
checkQuota(userId)
  ├─ Exceeded + past 2-day buffer → sendPush("Quota reached") → STOP
  │
  ▼
Check duration: > 600s → sendPush("10 min limit") → STOP
  │
  ▼
downloadMediaMessage(msg, 'buffer') → /tmp/wa_{userId}_{ts}.ogg
  │
  ▼
Groq Whisper API
  ├─ model: whisper-large-v3-turbo
  ├─ language: user's preferred language(s) as hint
  │
  ▼
Groq LLM (llama-3.3-70b-versatile)
  ├─ One-line summary in transcript's language
  ├─ Gibberish detection → language_ok: false
  │
  ▼
Save to transcriptions table
  ├─ Increment usage.minutes_used += ceil(duration_sec / 60)
  │
  ▼
Send Expo Push Notification
  ├─ Title: "🎙️ {sender_name}"
  ├─ Body: summary (truncated 100 chars)
  ├─ Data: { transcriptionId }
  │
  ▼
Delete temp file
```

**On failure at any step (except quota/duration):** if the audio was already downloaded successfully, store the buffer in `pending_transcriptions.audio_data` (bytea) so retries don't depend on WhatsApp media URL availability (URLs expire within hours). If the failure was during download itself, store only the message metadata and attempt re-download on retry (may fail if URL expired). 3 attempts max with exponential backoff (30s, 60s, 120s). After 3 failures → push notification to user. Temp audio files are always cleaned up after each attempt (success or failure).

Each message is processed fire-and-forget — one slow/failed message doesn't block others.

**Soft block (2-day buffer):** when `usage.minutes_used` reaches the plan limit, `quota_exceeded_at` is set to `now()`. For the next 2 days, transcriptions continue but are saved with `visible: false`. The user sees "X transcriptions waiting — upgrade to unlock" in the app. On upgrade, all hidden transcriptions for the current month are set to `visible: true`. After 2 days without upgrade, transcription stops entirely.

### Usage Rounding

Minutes are billed per-message: `ceil(duration_sec / 60)`. A 10-second message costs 1 minute. This is intentional — it's simple and predictable for the user. The free tier (5 min) still covers ~5-10 short voice messages per month.

### Gibberish Detection UX

When Whisper produces a bad transcription (`language_ok: false`), the push notification is still sent with the summary replaced by: "Transcription may be inaccurate". In the app, the transcription is shown with a warning banner. The user still sees the raw transcript.

### Account Deletion

Most tables referencing `users(id)` use `ON DELETE CASCADE` (subscriptions, whatsapp_sessions, transcriptions, usage, push_tokens, pending_transcriptions, user_settings). Exception: `users.referred_by_user_id` and `referrals.referrer_user_id` use `ON DELETE SET NULL` to avoid cascading deletion to referred users. When a user deletes their account: Baileys session is closed, credentials are wiped, all transcriptions/usage/settings are deleted. Stripe subscription is cancelled via API before DB deletion.

### Row Creation

`user_settings` and `subscriptions` rows are created at signup (INSERT in the same transaction as the user row). This avoids NULL checks everywhere.

### Encryption

Single server-wide AES-256-GCM key stored as `ENCRYPTION_KEY` environment variable. Each encryption operation generates a random IV. No per-user key derivation for the MVP. Key rotation can be added later by re-encrypting all credentials with a new key during a maintenance window.

---

## API Routes

### Public
```
POST /auth/signup              { email, password, referralCode? }
POST /auth/login               { email, password } → session tokens
POST /webhooks/stripe          Stripe signature verified
```

### Protected (JWT required)
```
POST   /whatsapp/pair          { phoneNumber } → { code, expiresIn: 60 } (rate limited: 1 per 90s per user)
GET    /whatsapp/status        → { status }
DELETE /whatsapp/disconnect     Closes session, deletes credentials

GET    /transcriptions         ?page=1&limit=20
GET    /transcriptions/:id     Ownership verified

GET    /usage/current          → { minutesUsed, minutesLimit, resetDate }

GET    /subscription           Plan + extras + is_early_adopter
POST   /subscription/upgrade   → Stripe checkout session URL

POST   /push/register          { expoPushToken, platform }

PUT    /settings               { preferredLanguages, notificationsEnabled }
GET    /settings

GET    /referral/code          → user's referral code
```

---

## Mobile App Flow

### Onboarding (first launch)
1. **Welcome** → Sign up / Log in
2. **Sign Up** → email, password, optional referral code
3. **Push Permission** → request notification permission, register token
4. **Enter Phone** → WhatsApp number with country code
5. **Pairing Code** → display 8-digit code, 60s countdown, step-by-step instructions, poll status
6. **Connected** → confirmation screen → navigate to Home

### Subsequent launches
→ Straight to Home (if authenticated + WhatsApp connected)

### Main Screens
- **Home** — transcription feed with usage banner, sorted by recency
- **Transcription Detail** — sender, timestamp, duration, summary, full transcript
- **Settings** — WhatsApp status, preferred languages, subscription info, referral code
- **Upgrade** — plan comparison, add-on packs, Stripe checkout

### Push Notification
- Title: `🎙️ [Sender name]`
- Body: one-line summary (100 chars max)
- Tap → deep link to Transcription Detail screen

---

## Pricing Model

### Plans

| | Free | Launch (first 500) | Standard |
|---|---|---|---|
| Price | €0 | €5/year | €9.99/year |
| Minutes/month | 5 | 100 | 100 |
| Early adopter lock | — | Yes (price locked forever) | — |

### Add-ons (one-time purchase, valid until subscription renewal)

- +100 min/month → +€2
- +300 min/month → +€5
- Unlimited → +€10

Add-ons stack (buying +100 then +300 = +400 min/month). Stored in `extra_minutes_per_month`, expiry tracked via `addon_expires_at`. On subscription renewal, `extra_minutes_per_month` resets to 0 and `addon_expires_at` is cleared.

### When monthly limit is reached
- Transcriptions continue to be saved in DB (hidden from user)
- 2-day buffer: user sees "X transcriptions waiting — upgrade to unlock"
- After 2 days without upgrade: transcriptions stop, push notification with upgrade link

### Referral System

- Each user gets a unique referral code
- 1 referral → +50 permanent bonus min/month for both (referrer + new user), added to `subscriptions.bonus_minutes`
- 3 referrals → referrer's `subscriptions.expires_at` extended by 1 month (or no effect on free plan)
- Applied at signup only via the `referralCode` field. `POST /referral/apply` is removed — referral codes can only be used during account creation. This avoids dual-path ambiguity.
- Each user can only be referred once (`referred_user_id` is UNIQUE on `referrals`)

---

## Stripe Integration

1. **Signup** → `stripe_customer_id` created in background (no payment)
2. **Upgrade** → `POST /subscription/upgrade` creates Stripe Checkout Session (mode: `subscription` for annual plan, mode: `payment` for add-ons)
3. **Webhook events:** `checkout.session.completed`, `invoice.paid`, `customer.subscription.deleted`
4. **Early adopter:** first 500 paid users get `is_early_adopter: true`, price locked on renewal. Enforced via `SELECT COUNT(*) FROM subscriptions WHERE is_early_adopter = true` before setting the flag. Use a DB transaction to prevent race conditions.

---

## Implementation Phases

| Phase | Scope | Dependency |
|---|---|---|
| **1** | Core backend — Baileys session manager + transcription pipeline + push notifications | None |
| **2** | Backend API + DB — Supabase schema, auth, REST routes, usage tracking | Phase 1 |
| **3** | Mobile app MVP — Auth, pairing flow, transcription feed, push handling | Phase 2 |
| **4** | Payments + referrals — Stripe integration, add-on packs, referral system | Phase 3 |
| **5** | Landing page — marketing site, pricing, app store links, SEO | Phase 1 (can run in parallel) |

---

## Cost Estimate (1000 free users × 5 min/month)

| Service | Annual Cost |
|---|---|
| Groq Whisper (1000h/year) | ~$110 |
| Groq LLM (~75K calls/year) | ~$15 |
| VPS (4GB RAM) | ~$120-180 |
| Supabase (free tier or Pro) | $0-300 |
| Expo Push | $0 |
| **Total** | **~$250-600/year** |

Break-even: ~100 users on the €5/year plan covers free tier costs.
