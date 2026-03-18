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
