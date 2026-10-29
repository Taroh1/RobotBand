import test from 'node:test';
import assert from 'node:assert/strict';
import { createCipheriv } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { generateKey, seal, open } from '../tools/chat-crypto.mjs';

const FORMAT = 'robotband-codex-chat-v1';
const MAX_BYTES = 32 * 1024 * 1024;

function flipBase64(value) {
  const buffer = Buffer.from(value, 'base64');
  buffer[0] ^= 1;
  return buffer.toString('base64');
}

// Produces authenticated malformed fixtures without requiring real conversations.
function envelopeForBytes(bytes, key) {
  const iv = Buffer.alloc(12, 7);
  const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
  cipher.setAAD(Buffer.from(FORMAT));
  const ciphertext = Buffer.concat([cipher.update(bytes), cipher.final()]);
  return { format: FORMAT, algorithm: 'aes-256-gcm', iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64') };
}

test('round trips Unicode JSON with a fresh key and nonce and contains only ciphertext', () => {
  const key = generateKey();
  assert.equal(Buffer.isBuffer(key), true);
  assert.equal(key.length, 32);
  assert.notDeepEqual(key, generateKey());
  const payload = { messages: [{ role: 'user', text: 'Geheime Akkorde 🎹 äöü\nzweite Zeile' }], data: [true, null, 2] };
  const first = seal(payload, key), second = seal(payload, key);
  assert.deepEqual(Object.keys(first), ['format', 'algorithm', 'iv', 'tag', 'ciphertext']);
  assert.equal(Buffer.from(first.iv, 'base64').length, 12);
  assert.equal(Buffer.from(first.tag, 'base64').length, 16);
  assert.notEqual(first.iv, second.iv);
  assert.notEqual(first.ciphertext, second.ciphertext);
  assert.equal(JSON.stringify(first).includes('Geheime Akkorde'), false);
  assert.equal(JSON.stringify(first).includes('messages'), false);
  assert.deepEqual(open(JSON.parse(JSON.stringify(first)), key), payload);
  assert.deepEqual(open(second, key), payload);
});

test('wrong keys, changed ciphertext, IV and tags are rejected before decompression', () => {
  const key = generateKey(), envelope = seal({ secret: 'fixture' }, key);
  assert.throws(() => open(envelope, generateKey()), /authentication failed/);
  for (const field of ['iv', 'tag', 'ciphertext']) {
    assert.throws(() => open({ ...envelope, [field]: flipBase64(envelope[field]) }, key), /authentication failed/);
  }
});

test('requires exact binary key length for sealing and opening', () => {
  const key = generateKey(), envelope = seal(null, key);
  for (const invalid of [null, undefined, [], 'a'.repeat(32), Buffer.alloc(31), Buffer.alloc(33)]) {
    assert.throws(() => seal({}, invalid), /32-byte/);
    assert.throws(() => open(envelope, invalid), /32-byte/);
  }
  assert.equal(open(envelope, new Uint8Array(key)), null);
});

test('rejects invalid envelopes, metadata and noncanonical base64', () => {
  const key = generateKey(), envelope = seal({ ok: true }, key);
  for (const invalid of [null, [], {}, { ...envelope, format: 'other' }, { ...envelope, algorithm: 'aes-128-gcm' },
    { ...envelope, plaintext: 'extra' }, { ...envelope, iv: '' }, { ...envelope, tag: '!!!!' },
    { ...envelope, ciphertext: envelope.ciphertext + '\n' }, { ...envelope, iv: Buffer.alloc(11).toString('base64') },
    { ...envelope, tag: envelope.tag.slice(0, -2) + 'B=' }, { ...envelope, ciphertext: 'AA' }]) {
    assert.throws(() => open(invalid, key));
  }
  assert.throws(() => open({ ...envelope, ciphertext: 'A'.repeat(64 * 1024 * 1024 + 4) }, key), /encoding/);
  assert.throws(() => seal(undefined, key), /JSON-serializable/);
  assert.throws(() => seal(1n, key), /JSON-serializable/);
  const cyclic = {}; cyclic.self = cyclic;
  assert.throws(() => seal(cyclic, key), /JSON-serializable/);
});

test('limits plaintext bytes both before sealing and during decompression', () => {
  const key = generateKey();
  const atLimit = 'x'.repeat(MAX_BYTES - 2); // JSON quotes count toward the limit.
  assert.equal(open(seal(atLimit, key), key).length, atLimit.length);
  assert.throws(() => seal(atLimit + 'x', key), /32 MiB/);
  const bomb = envelopeForBytes(gzipSync(Buffer.alloc(MAX_BYTES + 1, 0x61)), key);
  assert.throws(() => open(bomb, key), /oversized compressed data/);
});

test('authenticated invalid gzip and invalid JSON fail without exposing plaintext', () => {
  const key = generateKey();
  assert.throws(() => open(envelopeForBytes(Buffer.from('not gzip'), key), key), /invalid or oversized/);
  const secretText = 'private malformed JSON fixture';
  assert.throws(() => open(envelopeForBytes(gzipSync(Buffer.from(secretText)), key), key), error => {
    assert.equal(error.message, 'Decrypted chat is not valid JSON.');
    assert.equal(error.message.includes(secretText), false);
    return true;
  });
});
