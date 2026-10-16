// -----------------------------------------------------------------------------
// A session with a purifier, against the fake device: sync, encrypted status,
// pushed changes, commands, a refused command that re-syncs, a lost device.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PhilipsClient, PhilipsError, readStatusPayload } from '../src/philips/client.js';
import { CoapEndpoint } from '../src/philips/endpoint.js';
import { FakePhilips, createNetwork } from './helpers/fakePhilips.js';
import { AC2889, FAST_ENDPOINT } from './helpers/world.js';

function setup(t, options = {}) {
  const device = new FakePhilips(AC2889, '192.0.2.10');
  const network = createNetwork([device]);
  const endpoint = new CoapEndpoint({ createSocket: network.createSocket, timings: FAST_ENDPOINT });
  const pushed = [];
  const client = new PhilipsClient({
    endpoint,
    host: device.host,
    onStatus: (status) => pushed.push(status),
    ...options,
  });
  t.after(() => endpoint.close());
  return { device, endpoint, client, pushed };
}

const wait = (ms = 10) => new Promise((resolve) => setTimeout(resolve, ms));

test('client: syncs once, then reads the decrypted status', async (t) => {
  const { device, client } = setup(t);
  const first = await client.getStatus();
  assert.equal(first.modelid, 'AC2889/10');
  assert.equal(first.pwr, '1');
  await client.getStatus();
  assert.equal(device.count('/sys/dev/sync'), 1);
  assert.equal(device.count('/sys/dev/status'), 2);
  // Both reads refreshed the same observation.
  assert.equal(device.observers.size, 1);
});

test('client: a change made on the purifier is pushed', async (t) => {
  const { device, client, pushed } = setup(t);
  await client.getStatus();
  device.change({ mode: 'A', pm25: 15 });
  await wait();
  assert.equal(pushed.length, 1);
  assert.equal(pushed[0].mode, 'A');
  assert.equal(pushed[0].pm25, 15);
});

test('client: a command is encrypted with the session counter and applied', async (t) => {
  const { device, client, pushed } = setup(t);
  await client.getStatus();
  await client.setValues({ pwr: '0' });
  assert.deepEqual(device.controls, [{ pwr: '0' }]);
  assert.equal(device.status.pwr, '0');
  await wait();
  assert.equal(pushed.at(-1).pwr, '0', 'the device pushes its new state');
  await client.setValues({ mode: 'P' });
  assert.equal(device.status.mode, 'P');
});

test('client: a refused command re-syncs once and is sent again', async (t) => {
  const { device, client } = setup(t);
  await client.getStatus();
  device.refuse = 1;
  await client.setValues({ cl: true });
  assert.equal(device.count('/sys/dev/sync'), 2);
  assert.equal(device.status.cl, true);

  device.refuse = 5;
  await assert.rejects(client.setValues({ cl: false }), (err) => err.kind === 'refused');
});

test('client: a purifier that does not answer is unreachable, the next read re-syncs', async (t) => {
  const { device, client } = setup(t);
  await client.getStatus();
  device.online = false;
  await assert.rejects(client.getStatus(), (err) => err instanceof PhilipsError && err.unreachable);
  device.online = true;
  await client.getStatus();
  assert.equal(device.count('/sys/dev/sync'), 2);
});

test('client: a push too large for one datagram asks for a full read', async (t) => {
  let stale = 0;
  const { device, client, pushed } = setup(t, { onStale: () => (stale += 1) });
  device.blockSize = 256;
  const status = await client.getStatus();
  assert.equal(status.modelid, 'AC2889/10');
  device.change({ pm25: 50 });
  await wait();
  assert.equal(stale, 1);
  assert.equal(pushed.length, 0);
});

test('client: closing ends the observation on the device', async (t) => {
  const { device, client } = setup(t);
  await client.getStatus();
  assert.equal(device.observers.size, 1);
  await client.close();
  assert.equal(device.observers.size, 0);
});

test('client: a clear JSON status (old firmware) is read too; garbage is a protocol error', () => {
  const status = readStatusPayload(Buffer.from('{"state":{"reported":{"pwr":"1"}}}'));
  assert.deepEqual(status, { pwr: '1' });
  assert.throws(
    () => readStatusPayload(Buffer.from('not a status at all, not hex either')),
    (err) => err.kind === 'protocol',
  );
});
