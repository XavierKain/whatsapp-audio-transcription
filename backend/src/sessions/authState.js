const { encrypt, decrypt } = require('../services/encryption');
const supabase = require('../db/supabase');
const { proto, initAuthCreds, BufferJSON } = require('@whiskeysockets/baileys');

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
      const decrypted = JSON.parse(decrypt(session.credentials_json, encryptionKey), BufferJSON.reviver);
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
      JSON.stringify({ creds, keys }, BufferJSON.replacer),
      encryptionKey
    );

    // Use update (not upsert) to avoid overwriting phone_number/status
    await supabase
      .from('whatsapp_sessions')
      .update({ credentials_json: encrypted })
      .eq('user_id', userId);
  };

  return { state, saveCreds };
}

module.exports = { useSupabaseAuthState };
