// -----------------------------------------------------------------------------
// The encryption of the Philips air purifier CoAP protocol, as implemented by
// aioairctrl (kongo09, MIT) and py-air-control (rgerganov, MIT).
//
// Wire format of an encrypted payload, all upper-case hexadecimal text:
//
//   [counter: 8 chars][AES-128-CBC ciphertext][SHA-256 digest: 64 chars]
//
// The counter is a 32-bit number the client gets from the device at sync time
// (POST /sys/dev/sync) and increments before each message it encrypts. The
// AES key and IV are the two halves of MD5("JiangPan" + counter), taken as
// upper-case hexadecimal TEXT (16 ASCII bytes each), and the digest is the
// SHA-256 of counter + ciphertext, as text. "JiangPan" is the constant of the
// protocol, the same in every device: this protects nothing, it only has to
// be spoken.
// -----------------------------------------------------------------------------

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const SECRET = 'JiangPan';
const COUNTER_LENGTH = 8;
const DIGEST_LENGTH = 64;
const HEX = /^[0-9A-F]*$/;

export class DigestMismatchError extends Error {
  constructor() {
    super('The payload digest does not match: corrupted or not encrypted');
    this.name = 'DigestMismatchError';
  }
}

/** The AES key and IV of one counter value. */
function keyAndIv(counter) {
  const hash = createHash('md5')
    .update(SECRET + counter)
    .digest('hex')
    .toUpperCase();
  return {
    key: Buffer.from(hash.slice(0, 16), 'ascii'),
    iv: Buffer.from(hash.slice(16), 'ascii'),
  };
}

const digestOf = (counter, ciphertext) =>
  createHash('sha256')
    .update(counter + ciphertext)
    .digest('hex')
    .toUpperCase();

/** A counter value as the protocol writes it: 8 upper-case hex digits. */
export function formatCounter(value) {
  return (value >>> 0).toString(16).toUpperCase().padStart(COUNTER_LENGTH, '0');
}

/** The random 4-byte value a client sends to /sys/dev/sync. */
export function syncNonce() {
  return randomBytes(4).toString('hex').toUpperCase();
}

/** True for a counter the device may answer to a sync. */
export function isCounter(text) {
  return typeof text === 'string' && text.length === COUNTER_LENGTH && HEX.test(text);
}

/** Encrypt `plaintext` with one counter value (already incremented). */
export function encryptWith(counter, plaintext) {
  const { key, iv } = keyAndIv(counter);
  const cipher = createCipheriv('aes-128-cbc', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
    .toString('hex')
    .toUpperCase();
  return counter + ciphertext + digestOf(counter, ciphertext);
}

/**
 * Decrypt a payload of the device. The counter travels in the payload, so no
 * session state is needed.
 * @throws {DigestMismatchError} when the digest does not match
 */
export function decrypt(payload) {
  const text = String(payload).trim().toUpperCase();
  if (text.length < COUNTER_LENGTH + 32 + DIGEST_LENGTH || !HEX.test(text)) {
    throw new DigestMismatchError();
  }
  const counter = text.slice(0, COUNTER_LENGTH);
  const ciphertext = text.slice(COUNTER_LENGTH, -DIGEST_LENGTH);
  const digest = text.slice(-DIGEST_LENGTH);
  if (digest !== digestOf(counter, ciphertext)) {
    throw new DigestMismatchError();
  }
  const { key, iv } = keyAndIv(counter);
  const decipher = createDecipheriv('aes-128-cbc', key, iv);
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, 'hex')),
    decipher.final(),
  ]).toString('utf8');
}

/**
 * The encryption state of one session with one device: the counter it gave
 * at sync time, incremented before each message (wrapping at 32 bits).
 */
export class EncryptionContext {
  constructor(counter) {
    if (!isCounter(counter)) {
      throw new Error('Invalid client key from the device');
    }
    this.value = Number.parseInt(counter, 16);
  }

  encrypt(plaintext) {
    this.value = (this.value + 1) % 0x100000000;
    return encryptWith(formatCounter(this.value), plaintext);
  }
}
