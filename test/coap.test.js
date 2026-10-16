// -----------------------------------------------------------------------------
// The CoAP codec and the endpoint: wire format, options, retransmissions,
// confirmable notifications, unknown observations, blocks.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CODES,
  CoapFormatError,
  OPTIONS,
  TYPES,
  codeText,
  decode,
  decodeBlock,
  encode,
  encodeBlock,
  uintOption,
  uriPath,
  pathOptions,
} from '../src/philips/coap.js';
import { CoapEndpoint } from '../src/philips/endpoint.js';
import { FakePhilips, createNetwork } from './helpers/fakePhilips.js';
import { AC2889, FAST_ENDPOINT } from './helpers/world.js';

test('coap: a GET with Observe and Uri-Path, byte for byte (RFC 7252 layout)', () => {
  const datagram = encode({
    type: TYPES.NON,
    code: CODES.GET,
    messageId: 0x1234,
    token: Buffer.from('a1b2c3d4', 'hex'),
    options: [...pathOptions('/sys/dev/status'), { number: OPTIONS.OBSERVE, value: 0 }],
  });
  assert.equal(
    datagram.toString('hex'),
    // 0x54 = v1 NON TKL4, 0x01 = GET, id, token, Observe(6) empty,
    // Uri-Path(11) "sys" "dev" "status", no payload.
    '54011234a1b2c3d4' + '60' + '53737973' + '03646576' + '06737461747573',
  );
  const message = decode(datagram);
  assert.equal(message.type, TYPES.NON);
  assert.equal(message.code, CODES.GET);
  assert.equal(message.messageId, 0x1234);
  assert.equal(uriPath(message), '/sys/dev/status');
  assert.equal(uintOption(message, OPTIONS.OBSERVE), 0);
  assert.equal(message.payload.length, 0);
});

test('coap: options above 12 and long values use the extended nibbles', () => {
  const payload = 'x'.repeat(300);
  const message = decode(
    encode({
      type: TYPES.CON,
      code: CODES.CONTENT,
      messageId: 7,
      options: [
        { number: OPTIONS.MAX_AGE, value: 60 },
        { number: OPTIONS.BLOCK2, value: encodeBlock({ num: 3, more: true, size: 512 }) },
        { number: OPTIONS.URI_QUERY, value: 'q'.repeat(20) },
        { number: 300, value: Buffer.alloc(270, 1) },
      ],
      payload,
    }),
  );
  assert.equal(uintOption(message, OPTIONS.MAX_AGE), 60);
  assert.deepEqual(decodeBlock(uintOption(message, OPTIONS.BLOCK2)), {
    num: 3,
    more: true,
    size: 512,
  });
  assert.equal(message.options.find((option) => option.number === 300).value.length, 270);
  assert.equal(message.payload.toString(), payload);
  assert.equal(codeText(CODES.CONTENT), '2.05');
});

test('coap: what is not CoAP is refused', () => {
  assert.throws(() => decode(Buffer.from([0x00, 0x01])), CoapFormatError);
  assert.throws(() => decode(Buffer.from('{"method":"getPilot"}')), CoapFormatError);
  assert.throws(() => decode(Buffer.from([0x40, 0x01, 0x00, 0x01, 0xff])), CoapFormatError);
  assert.throws(() => decode(Buffer.from([0x40, 0x01, 0x00, 0x01, 0xf0])), CoapFormatError);
});

function endpointFor(devices) {
  const network = createNetwork(devices);
  const endpoint = new CoapEndpoint({ createSocket: network.createSocket, timings: FAST_ENDPOINT });
  return { network, endpoint };
}

test('endpoint: a lost datagram is sent again with the same message id', async (t) => {
  const device = new FakePhilips(AC2889, '192.0.2.10');
  const { endpoint } = endpointFor([device]);
  t.after(() => endpoint.close());
  device.drop = 1;
  const answer = await endpoint.request({
    host: device.host,
    code: CODES.POST,
    path: '/sys/dev/sync',
    payload: '00000001',
  });
  assert.equal(answer.payload.toString(), '1A2B3C00');
  assert.equal(device.count('/sys/dev/sync'), 2);
});

test('endpoint: no answer at all times out as unreachable', async (t) => {
  const device = new FakePhilips(AC2889, '192.0.2.10');
  device.online = false;
  const { endpoint } = endpointFor([device]);
  t.after(() => endpoint.close());
  await assert.rejects(
    endpoint.request({ host: device.host, code: CODES.GET, path: '/sys/dev/status' }),
    (err) => err.kind === 'timeout' && err.unreachable,
  );
});

test('endpoint: a confirmable notification is acknowledged; an unknown one is reset', async (t) => {
  const device = new FakePhilips(AC2889, '192.0.2.10');
  device.confirmable = true;
  const { endpoint } = endpointFor([device]);
  t.after(() => endpoint.close());
  const token = Buffer.from('01020304', 'hex');
  const seen = [];
  const stop = endpoint.observe(device.host, token, (message) => seen.push(message));
  await endpoint.request({
    host: device.host,
    code: CODES.GET,
    path: '/sys/dev/status',
    observe: 0,
    token,
  });
  device.change({ pm25: 30 });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(seen.length, 1);
  assert.equal(device.acks, 1);

  stop();
  device.change({ pm25: 31 });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(seen.length, 1);
  assert.equal(device.resets, 1, 'the device is told to drop the observation');
});

test('endpoint: a status cut in blocks is put back together', async (t) => {
  const device = new FakePhilips(AC2889, '192.0.2.10');
  device.blockSize = 256;
  const { endpoint } = endpointFor([device]);
  t.after(() => endpoint.close());
  const answer = await endpoint.request({
    host: device.host,
    code: CODES.GET,
    path: '/sys/dev/status',
  });
  assert.equal(answer.payload.toString(), device.lastPayload);
  assert.ok(device.count('/sys/dev/status') > 2);
});
