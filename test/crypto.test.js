// -----------------------------------------------------------------------------
// The encryption of the protocol, against vectors produced by the reference
// implementation (aioairctrl's EncryptionContext, kongo09, MIT): the same
// plaintext and counter must give the same bytes, both ways.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DigestMismatchError,
  EncryptionContext,
  decrypt,
  encryptWith,
  formatCounter,
  isCounter,
  syncNonce,
} from '../src/philips/crypto.js';

// aioairctrl: ctx.set_client_key('0000A1B1'); ctx.encrypt(PLAINTEXT)
const PLAINTEXT =
  '{"state":{"reported":{"name":"Bedroom","pwr":"1","mode":"P","pm25":12,"DeviceId":"00000000000000000000000000000abc"}}}';
const ENCRYPTED =
  '0000A1B2342ED3DFC74B7C33D479C4733AF1E573AF6FE678A3939B2F60647B24F57CD331DE6A86A138244D2FC0DF8D9A663C8B29B694FA8F2D68F13C366BC618FE1372D7610B16F4007CE0EEEC0E6E75A0F228A9A16E5B9C22CF47953418ACAC237A1DBF35C9E00381CAAB6A0D3ABBFE42E303D87FB10C34FABC6045A4F70C8205EA3399FDA7AE678D1F1F18A61476A6230072A9F53909FFB226BDA0D51B35D0C4F5150F';
// aioairctrl: ctx.set_client_key('FFFFFFFF'); ctx.encrypt('{"status":"success"}')
const WRAPPED =
  '000000000CBFEDCF1FBABAAE1B8761F1B9135B0C962670850A104421AA28FE082F692762DA8F2AA622A9563AC7E5CE65FFAB24A43EC024B95A6D9396A8F66E7DBC3949DA';

test('crypto: encrypts like the reference implementation, counter incremented first', () => {
  const context = new EncryptionContext('0000A1B1');
  assert.equal(context.encrypt(PLAINTEXT), ENCRYPTED);
  assert.equal(encryptWith('0000A1B2', PLAINTEXT), ENCRYPTED);
});

test('crypto: decrypts the reference vector, the counter travels in the payload', () => {
  assert.equal(decrypt(ENCRYPTED), PLAINTEXT);
  assert.equal(decrypt(ENCRYPTED.toLowerCase()), PLAINTEXT);
});

test('crypto: the counter wraps at 32 bits', () => {
  const context = new EncryptionContext('FFFFFFFF');
  assert.equal(context.encrypt('{"status":"success"}'), WRAPPED);
  assert.equal(formatCounter(0x1a), '0000001A');
});

test('crypto: a tampered payload or a clear text is refused', () => {
  const flipped =
    ENCRYPTED.slice(0, 20) + (ENCRYPTED[20] === '0' ? '1' : '0') + ENCRYPTED.slice(21);
  assert.throws(() => decrypt(flipped), DigestMismatchError);
  assert.throws(() => decrypt('{"status":"success"}'), DigestMismatchError);
  assert.throws(() => decrypt(''), DigestMismatchError);
});

test('crypto: sync nonces and counters are 8 upper-case hex digits', () => {
  for (let round = 0; round < 20; round += 1) {
    assert.ok(isCounter(syncNonce()));
  }
  assert.equal(isCounter('1a2b3c4d'), false);
  assert.equal(isCounter('1A2B3C'), false);
  assert.throws(() => new EncryptionContext('nope'));
});
