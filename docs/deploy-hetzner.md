# Deploy AudioReadr Backend on Hetzner VPS

**Repo:** `https://github.com/XavierKain/whatsapp-audio-transcription`

## 1. Prerequisites

```bash
# Node.js 20 LTS (NOT Node 25 — it breaks Baileys crypto handshake)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -
sudo apt-get install -y nodejs
node -v  # must be v20.x
```

## 2. Clone & Install

```bash
git clone https://github.com/XavierKain/whatsapp-audio-transcription.git
cd whatsapp-audio-transcription/backend
npm install
```

## 3. Patch Baileys (MANDATORY)

The `passive: true` patch preserves phone push notifications when Baileys is connected.

```bash
# Patch passive:true in generateLoginNode (line ~51)
sed -i 's/passive: false,/passive: true,/' node_modules/@whiskeysockets/baileys/lib/Utils/validate-connection.js

# The sed above patches BOTH occurrences. The second one (registration node, line ~91)
# must stay false. Fix it:
sed -i '91s/passive: true,/passive: false,/' node_modules/@whiskeysockets/baileys/lib/Utils/validate-connection.js

# Verify:
grep -n "passive:" node_modules/@whiskeysockets/baileys/lib/Utils/validate-connection.js
# Expected output:
#   51:        passive: true,    ← login node (patched)
#   91:        passive: false,   ← registration node (original)
```

## 4. Environment file

```bash
cat > .env << 'EOF'
SUPABASE_URL=<your Supabase project URL>
SUPABASE_SERVICE_KEY=<your Supabase service_role secret key>
SUPABASE_ANON_KEY=<your Supabase publishable key>
GROQ_API_KEY=<your Groq API key>
ENCRYPTION_KEY=<generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
STRIPE_SECRET_KEY=sk_test_placeholder
STRIPE_WEBHOOK_SECRET=whsec_placeholder
EXPO_ACCESS_TOKEN=placeholder
PORT=3000
EOF
```

## 5. Test WhatsApp Connection (QR code)

Run this standalone test script first to verify WhatsApp linking works:

```bash
node -e "
const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const pino = require('pino');
const qrcode = require('qrcode-terminal');
(async () => {
  const { state, saveCreds } = await useMultiFileAuthState('./wa-test-auth');
  const { version } = await fetchLatestBaileysVersion();
  const sock = makeWASocket({ version, auth: state, logger: pino({ level: 'silent' }), browser: ['Mac OS', 'Desktop', '10.15.7'], syncFullHistory: false, markOnlineOnConnect: false, keepAliveIntervalMs: 30000 });
  sock.ev.on('creds.update', saveCreds);
  sock.ev.on('connection.update', ({ connection, qr, lastDisconnect }) => {
    if (qr) { console.log('SCAN:'); qrcode.generate(qr, { small: true }); }
    if (connection === 'open') { console.log('CONNECTED!'); }
    if (connection === 'close') { console.log('Closed:', lastDisconnect?.error?.message); }
  });
})();
"
```

→ Scan the QR with **WhatsApp → Settings → Linked Devices → Link a Device**
→ You should see `CONNECTED!` in the terminal
→ Once confirmed, delete the test auth: `rm -rf wa-test-auth/`

## 6. Start the backend

```bash
# Simple:
npm start

# With pm2 (recommended for production):
npm install -g pm2
pm2 start src/index.js --name audioreadr
pm2 save
pm2 startup
```

## Critical Notes

| Item | Detail |
|------|--------|
| **Node version** | Must be Node 20 or 22 LTS. Node 25 breaks Baileys crypto handshake (Stream Errored 515). |
| **Baileys patch** | `passive: true` in `generateLoginNode` is mandatory. Without it, phone push notifications are suppressed. |
| **QR expiry** | QR codes expire in ~20 seconds. Be quick or wait for the next one. |
| **QR fails?** | Delete `wa-test-auth/` and retry — stale credentials cause 401 errors. |
| **Pairing code** | `requestPairingCode()` does NOT work reliably with Baileys 6.7.x. Use QR code for initial pairing. |
| **VPS required** | WhatsApp may block linked device connections from residential IPs. A VPS (Hetzner, OVH, etc.) is recommended. |

## Reference: Working OpenClaw Setup

The existing OpenClaw WhatsApp listener uses this exact stack:
- Node.js v22.22.0
- Baileys 6.7.21 (installed as ^6.7.16)
- Ubuntu 22.04
- Same `passive: true` patch
- QR code pairing (not pairing code)
