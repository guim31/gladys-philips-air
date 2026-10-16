// -----------------------------------------------------------------------------
// The integration end to end: the SDK's fake Gladys, fake purifiers on a fake
// UDP network, the hub and its handlers.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FEATURE_KEYS, WATER } from '../src/devices.js';
import { TRIGGER } from '../src/hub.js';
import {
  AC0850,
  AC2220,
  AC2889,
  AC3829,
  FakePhilips,
  createAll,
  createWorld,
  deviceExternalId,
  featureId,
  settle,
} from './helpers/world.js';

async function createdWorld(t, options) {
  const world = await createWorld(options);
  t.after(() => world.app.stop());
  await createAll(world);
  return world;
}

const state = (world, fixture, key) => world.fake.lastState(featureId(world.gladys, fixture, key));

const deviceOf = (world, fixture) =>
  world.fake.discoveredDevices.find(
    (device) => device.external_id === deviceExternalId(world.gladys, fixture),
  );

const featureOf = (world, fixture, key) => ({
  external_id: featureId(world.gladys, fixture, key),
});

test('hub: one device per purifier, keyed on its DeviceId, never polled by Gladys', async (t) => {
  const world = await createWorld({
    devices: [new FakePhilips(AC2889, '192.0.2.10'), new FakePhilips(AC3829, '192.0.2.11')],
  });
  t.after(() => world.app.stop());
  const devices = world.fake.discoveredDevices;
  assert.equal(devices.length, 2);
  const purifier = deviceOf(world, AC2889);
  assert.equal(purifier.name, 'Luftreiniger (AC2889/10)');
  assert.equal(purifier.model, 'AC2889/10');
  assert.equal(purifier.should_poll, false);
  assert.equal(purifier.poll_frequency, undefined);
  assert.deepEqual(purifier.params, [
    { name: 'IP_ADDRESS', value: '192.0.2.10' },
    { name: 'MODEL', value: 'AC2889/10' },
    { name: 'FIRMWARE', value: '1.0.7' },
  ]);
  assert.deepEqual(
    purifier.features.map((feature) => feature.external_id.split(':').at(-1)),
    [
      'power',
      'mode',
      'fan-speed',
      'pm25',
      'allergen-index',
      'child-lock',
      'display',
      'pre-filter',
      'hepa-filter',
    ],
  );
  const mode = purifier.features.find((feature) => feature.external_id.endsWith(':mode'));
  assert.deepEqual(
    mode.supported_options.map((option) => option.value),
    ['auto', 'allergen', 'bacteria', 'sleep', 'turbo', 'manual'],
  );
  const humidifier = deviceOf(world, AC3829);
  for (const key of ['target-humidity', 'humidification', 'water-tank', 'humidity', 'wick']) {
    assert.ok(
      humidifier.features.some((feature) => feature.external_id.endsWith(`:${key}`)),
      key,
    );
  }
  assert.equal(world.fake.connectionStatus.connected, true);
});

test('hub: the states of a created purifier, then its pushed changes, without any read', async (t) => {
  const device = new FakePhilips(AC2889, '192.0.2.10');
  const world = await createdWorld(t, { devices: [device] });
  assert.equal(state(world, AC2889, FEATURE_KEYS.POWER), 1);
  assert.equal(state(world, AC2889, FEATURE_KEYS.MODE), 'manual');
  assert.equal(state(world, AC2889, FEATURE_KEYS.SPEED), 1);
  assert.equal(state(world, AC2889, FEATURE_KEYS.PM25), 1);
  assert.equal(state(world, AC2889, FEATURE_KEYS.HEPA_FILTER), 4300);
  assert.equal(state(world, AC2889, FEATURE_KEYS.DISPLAY), '25');
  assert.deepEqual(world.fake.transports.at(-1), {
    device_external_id: deviceExternalId(world.gladys, AC2889),
    transport: 'local',
  });

  const reads = device.count('/sys/dev/status');
  device.change({ mode: 'A', pm25: 35, iaql: 8 });
  await settle(world);
  assert.equal(device.count('/sys/dev/status'), reads, 'no read: pushed by the device');
  assert.equal(state(world, AC2889, FEATURE_KEYS.MODE), 'allergen');
  assert.equal(state(world, AC2889, FEATURE_KEYS.PM25), 35);
  assert.equal(state(world, AC2889, FEATURE_KEYS.ALLERGEN_INDEX), 8);
});

test('hub: a change the push missed comes with the next read', async (t) => {
  const device = new FakePhilips(AC2889, '192.0.2.10');
  const world = await createdWorld(t, { devices: [device] });
  device.push = false;
  device.change({ pwr: '0' });
  await settle(world);
  assert.equal(state(world, AC2889, FEATURE_KEYS.POWER), 1);
  await world.hub.pollAll();
  assert.equal(state(world, AC2889, FEATURE_KEYS.POWER), 0);
});

test('hub: commands from Gladys reach the purifier with the keys of its model', async (t) => {
  const device = new FakePhilips(AC3829, '192.0.2.10');
  const world = await createdWorld(t, { devices: [device] });
  const purifier = deviceOf(world, AC3829);
  const set = (key, value) => world.fake.setValue(purifier, featureOf(world, AC3829, key), value);

  assert.equal((await set(FEATURE_KEYS.MODE, 'sleep')).success, true);
  assert.deepEqual(device.controls.at(-1), { pwr: '1', mode: 'S', om: 's' });
  assert.equal(state(world, AC3829, FEATURE_KEYS.MODE), 'sleep');

  await set(FEATURE_KEYS.SPEED, 3);
  assert.deepEqual(device.controls.at(-1), { pwr: '1', mode: 'M', om: '3' });
  assert.equal(state(world, AC3829, FEATURE_KEYS.MODE), 'manual');

  await set(FEATURE_KEYS.TARGET_HUMIDITY, '60');
  assert.deepEqual(device.controls.at(-1), { rhset: 60 });
  await set(FEATURE_KEYS.HUMIDIFICATION, 0);
  assert.deepEqual(device.controls.at(-1), { func: 'P' });
  await set(FEATURE_KEYS.CHILD_LOCK, 1);
  assert.deepEqual(device.controls.at(-1), { cl: true });
  await set(FEATURE_KEYS.DISPLAY, '0');
  assert.deepEqual(device.controls.at(-1), { aqil: 0 });
  await set(FEATURE_KEYS.POWER, 0);
  assert.deepEqual(device.controls.at(-1), { pwr: '0' });
  assert.equal(state(world, AC3829, FEATURE_KEYS.POWER), 0);

  const refused = await set(FEATURE_KEYS.MODE, 'bacteria');
  assert.equal(refused.success, false);
  assert.equal(device.controls.length, 7);

  // "Manual" picks the current speed back.
  await set(FEATURE_KEYS.MODE, 'manual');
  assert.deepEqual(device.controls.at(-1), { pwr: '1', mode: 'M', om: '3' });
});

test('hub: commands on the AC0850 and on the new generation', async (t) => {
  const air = new FakePhilips(AC0850, '192.0.2.10');
  const modern = new FakePhilips(AC2220, '192.0.2.11');
  const world = await createdWorld(t, { devices: [air, modern] });
  await world.fake.setValue(deviceOf(world, AC0850), featureOf(world, AC0850, 'mode'), 'sleep');
  assert.deepEqual(air.controls.at(-1), { 'D03-02': 'ON', 'D03-12': 'Sleep' });
  assert.equal(state(world, AC0850, 'mode'), 'sleep');
  await world.fake.setValue(deviceOf(world, AC2220), featureOf(world, AC2220, 'fan-speed'), 4);
  assert.deepEqual(modern.controls.at(-1), { D03102: 1, D0310C: 4 });
  assert.equal(state(world, AC2220, 'mode'), 'manual');
  assert.equal(state(world, AC2220, 'fan-speed'), 4);
});

test('hub: a purifier that stops answering is unreachable, then comes back', async (t) => {
  const device = new FakePhilips(AC2889, '192.0.2.10');
  const world = await createdWorld(t, { devices: [device] });
  device.online = false;
  await world.hub.pollAll();
  assert.equal(world.fake.transports.at(-1).transport, 'local', 'one miss is not enough');
  await world.hub.pollAll();
  assert.equal(world.fake.transports.at(-1).transport, 'unreachable');
  assert.equal(world.fake.connectionStatus.connected, false);

  device.online = true;
  device.status.pm25 = 12;
  await world.hub.pollAll();
  assert.equal(world.fake.transports.at(-1).transport, 'local');
  assert.equal(world.fake.connectionStatus.connected, true);
  assert.equal(state(world, AC2889, FEATURE_KEYS.PM25), 12);
});

test('hub: a new address for the same purifier keeps its device and its alerts', async (t) => {
  const device = new FakePhilips(AC2889, '192.0.2.10');
  device.status.fltsts0 = 0;
  const world = await createdWorld(t, { devices: [device] });
  assert.equal(world.fake.sceneEvents.length, 1, 'pre-filter to clean');
  const id = deviceExternalId(world.gladys, AC2889);
  device.host = '192.0.2.99';
  await world.fake.configUpdated({ language: 'en', hosts: '192.0.2.99' });
  await world.hub.idle();
  assert.equal(world.fake.discoveredDevices.length, 1);
  assert.equal(world.fake.discoveredDevices[0].external_id, id);
  assert.equal(world.fake.discoveredDevices[0].params[0].value, '192.0.2.99');
  assert.equal(world.fake.sceneEvents.length, 1, 'not fired again');

  // An address removed from the configuration takes its purifier off the list.
  await world.fake.configUpdated({ language: 'en', hosts: '' });
  assert.deepEqual(world.fake.discoveredDevices, []);
});

test('hub: a restart publishes the known purifiers before they answer', async (t) => {
  const device = new FakePhilips(AC2889, '192.0.2.10');
  const first = await createWorld({ devices: [device] });
  await first.app.stop();
  device.online = false;
  const second = await createWorld({ devices: [device], dataDir: first.dataDir });
  t.after(() => second.app.stop());
  assert.equal(second.fake.discoveredDevices.length, 1);
  assert.equal(
    second.fake.discoveredDevices[0].external_id,
    deviceExternalId(second.gladys, AC2889),
  );
});

test('hub: the maintenance trigger fires once per item, re-armed when done', async (t) => {
  const device = new FakePhilips(AC3829, '192.0.2.10');
  const world = await createdWorld(t, {
    devices: [device],
    config: { filter_warning_hours: '72' },
  });
  assert.deepEqual(world.fake.sceneEvents, []);

  device.change({ fltsts1: 70 });
  await settle(world);
  device.change({ fltsts1: 69 });
  await settle(world);
  assert.equal(world.fake.sceneEvents.length, 1);
  const [event] = world.fake.sceneEvents;
  assert.equal(event.key, TRIGGER);
  assert.deepEqual(event.data, {
    device: deviceExternalId(world.gladys, AC3829),
    item: 'hepa-filter',
    hours_left: 70,
    message: 'Nursery (AC3829/10): HEPA filter to replace (70 h left)',
  });

  // The pre-filter only when the purifier asks for it.
  device.change({ fltsts0: 50 });
  await settle(world);
  assert.equal(world.fake.sceneEvents.length, 1);
  device.change({ fltsts0: 0 });
  await settle(world);
  assert.equal(world.fake.sceneEvents.at(-1).data.item, 'pre-filter');

  // An empty tank while humidifying; the water state follows.
  device.change({ wl: 0, err: 49408 });
  await settle(world);
  assert.equal(world.fake.sceneEvents.at(-1).data.item, 'water-tank');
  assert.equal(state(world, AC3829, FEATURE_KEYS.WATER_TANK), WATER.LOW);
  assert.equal(world.fake.sceneEvents.length, 3);

  // A new filter re-arms its alert.
  device.change({ fltsts1: 4800 });
  await settle(world);
  device.change({ fltsts1: 10 });
  await settle(world);
  assert.equal(world.fake.sceneEvents.length, 4);
  assert.equal(world.fake.sceneEvents.at(-1).data.item, 'hepa-filter');
});

test('hub: no maintenance event for a purifier not added to Gladys', async (t) => {
  const device = new FakePhilips('classic-ac2889-10-prefilter', '192.0.2.10');
  const world = await createWorld({ devices: [device] });
  t.after(() => world.app.stop());
  await world.hub.pollAll();
  assert.deepEqual(world.fake.sceneEvents, []);
  // Once added, the pending item fires.
  await createAll(world);
  assert.equal(world.fake.sceneEvents.length, 1);
  assert.equal(world.fake.sceneEvents[0].data.item, 'pre-filter');
});

test('hub: the boost scene action runs turbo, then puts the previous mode back', async (t) => {
  const device = new FakePhilips(AC2889, '192.0.2.10');
  const world = await createdWorld(t, { devices: [device] });
  const id = deviceExternalId(world.gladys, AC2889);
  const ack = await world.fake.sceneAction('boost', { device: id, minutes: 30 });
  assert.equal(ack.success, true, ack.error);
  assert.match(ack.data.outputs.until, /^\d{4}-\d\d-\d\dT/);
  assert.deepEqual(device.controls.at(-1), { pwr: '1', mode: 'M', om: 't' });
  assert.equal(state(world, AC2889, FEATURE_KEYS.MODE), 'turbo');

  // The end comes (here: due at the next read).
  world.hub.boosts.get(device.status.DeviceId).until = Date.now() - 1;
  await world.hub.pollAll();
  assert.deepEqual(device.controls.at(-1), { pwr: '1', mode: 'M', om: '1' });
  assert.equal(state(world, AC2889, FEATURE_KEYS.MODE), 'manual');
  assert.equal(world.hub.boosts.size, 0);
});

test('hub: a boost ends by switching off a purifier that was off; a change meanwhile wins', async (t) => {
  const device = new FakePhilips(AC2889, '192.0.2.10');
  device.status.pwr = '0';
  const world = await createdWorld(t, { devices: [device] });
  const id = deviceExternalId(world.gladys, AC2889);
  await world.fake.sceneAction('boost', { device: id, minutes: 5 });
  world.hub.boosts.get(device.status.DeviceId).until = Date.now() - 1;
  await world.hub.pollAll();
  assert.deepEqual(device.controls.at(-1), { pwr: '0' });

  await world.fake.sceneAction('boost', { device: id, minutes: 5 });
  device.change({ mode: 'A' });
  await settle(world);
  const count = device.controls.length;
  world.hub.boosts.get(device.status.DeviceId).until = Date.now() - 1;
  await world.hub.pollAll();
  assert.equal(device.controls.length, count, 'left in allergen mode');
  assert.equal(world.hub.boosts.size, 0);

  const refused = await world.fake.sceneAction('boost', { device: id, minutes: 1000 });
  assert.equal(refused.success, false);
});

test('hub: a model missing from the list has no mode list, and says so once', async (t) => {
  const device = new FakePhilips('classic-unknown-ac9999', '192.0.2.10');
  const world = await createdWorld(t, { devices: [device] });
  const purifier = world.fake.discoveredDevices[0];
  assert.ok(!purifier.features.some((feature) => feature.external_id.endsWith(':mode')));
  assert.equal(state(world, 'classic-unknown-ac9999', FEATURE_KEYS.PM25), 9);
  const ack = await world.fake.action('check', {});
  assert.match(ack.data.message.en, /model not in the list/);
});

test('hub: onPoll (fallback) reads a purifier, but not twice within half a period', async (t) => {
  const device = new FakePhilips(AC2889, '192.0.2.10');
  const world = await createdWorld(t, { devices: [device] });
  const purifier = { external_id: deviceExternalId(world.gladys, AC2889) };
  const before = device.count('/sys/dev/status');
  assert.equal((await world.fake.poll(purifier)).success, true);
  assert.equal(device.count('/sys/dev/status'), before + 1);
  await world.fake.poll(purifier);
  assert.equal(device.count('/sys/dev/status'), before + 1);
});

test('hub: no address configured, or none answering, is shown in Gladys', async (t) => {
  const empty = await createWorld({ devices: [], config: { hosts: '' } });
  t.after(() => empty.app.stop());
  assert.equal(empty.fake.connectionStatus.connected, false);
  assert.match(empty.fake.connectionStatus.message.en, /Enter the IP address/);

  const device = new FakePhilips(AC2889, '192.0.2.10');
  device.online = false;
  const silent = await createWorld({ devices: [device] });
  t.after(() => silent.app.stop());
  await silent.hub.pollAll();
  assert.equal(silent.fake.connectionStatus.connected, false);
  assert.match(silent.fake.connectionStatus.message.en, /No Philips purifier answers/);
  const ack = await silent.fake.action('check', {});
  assert.match(
    ack.data.message.fr,
    /1 adresse\(s\), 0 répondent : 192\.0\.2\.10 \(ne répond pas\)/,
  );
});
