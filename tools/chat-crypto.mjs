import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';

const FORMAT = 'robotband-codex-chat-v1';
const ALGORITHM = 'aes-256-gcm';
const AAD = Buffer.from(FORMAT, 'utf8');
const MAX_PAYLOAD_BYTES = 32 * 1024 * 1024;
const MAX_BASE64_CHARS = 64 * 1024 * 1024;
const ENVELOPE_FIELDS = ['format', 'algorithm', 'iv', 'tag', 'ciphertext'];

function checkedKey(key) {
  if (!(key instanceof Uint8Array) || key.byteLength !== 32) {
    throw new TypeError('A 32-byte binary encryption key is required.');
  }
  return key;
}

function checkedBase64(value, name, expectedBytes) {
  const maxChars = expectedBytes === undefined ? MAX_BASE64_CHARS : Math.ceil(expectedBytes / 3) * 4;
  if (typeof value !== 'string' || value.length === 0 || value.length > maxChars
    || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) {
    throw new TypeError(`Invalid ${name} encoding.`);
  }
  const bytes = Buffer.from(value, 'base64');
  // Buffer.from accepts several non-canonical forms; the envelope does not.
  if (bytes.toString('base64') !== value || (expectedBytes !== undefined && bytes.length !== expectedBytes)) {
    throw new TypeError(`Invalid ${name} encoding.`);
  }
  return bytes;
}

/** Generate a fresh 256-bit binary key. Never print or commit this value. */
export function generateKey() {
  return randomBytes(32);
}

/** Compress a JSON payload, then encrypt and authenticate it under a fresh nonce. */
export function seal(payload, key) {
  checkedKey(key);
  let json;
  try { json = JSON.stringify(payload); }
  catch { throw new TypeError('Payload must be JSON-serializable.'); }
  if (typeof json !== 'string') throw new TypeError('Payload must be JSON-serializable.');
  if (Buffer.byteLength(json, 'utf8') > MAX_PAYLOAD_BYTES) {
    throw new RangeError('JSON payload exceeds the 32 MiB limit.');
  }

  const compressed = gzipSync(Buffer.from(json, 'utf8'));
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: 16 });
  cipher.setAAD(AAD);
  const ciphertext = Buffer.concat([cipher.update(compressed), cipher.final()]);
  return {
    format: FORMAT,
    algorithm: ALGORITHM,
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  };
}

/** Authenticate before decompressing; reject malformed, oversized or wrong-key data. */
export function open(envelope, key) {
  checkedKey(key);
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)
    || envelope.format !== FORMAT || envelope.algorithm !== ALGORITHM
    || Object.keys(envelope).length !== ENVELOPE_FIELDS.length
    || !ENVELOPE_FIELDS.every(field => Object.hasOwn(envelope, field))) {
    throw new TypeError('Unsupported encrypted chat envelope.');
  }
  const iv = checkedBase64(envelope.iv, 'iv', 12);
  const tag = checkedBase64(envelope.tag, 'tag', 16);
  const ciphertext = checkedBase64(envelope.ciphertext, 'ciphertext');
  let compressed;
  try {
    const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: 16 });
    decipher.setAAD(AAD);
    decipher.setAuthTag(tag);
    compressed = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    // Authentication failures must not expose decrypted bytes or key material.
    throw new Error('Encrypted chat authentication failed.');
  }

  let plain;
  try { plain = gunzipSync(compressed, { maxOutputLength: MAX_PAYLOAD_BYTES }); }
  catch { throw new Error('Encrypted chat contains invalid or oversized compressed data.'); }
  try { return JSON.parse(plain.toString('utf8')); }
  catch { throw new Error('Decrypted chat is not valid JSON.'); }
}
