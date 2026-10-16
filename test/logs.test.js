// -----------------------------------------------------------------------------
// What the container writes at the default level (info): the life of the
// purifiers and of Gladys, never one line per reading, and a repeated failure
// once. Nothing of a session (keys, decrypted payloads) at any level. Also:
// the hub reads the purifiers by its own timer, without onPoll.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GladysApiError } from '@gladysassistant/integration-sdk';
import { FEATURE_KEYS } from '../src/devices.js';
import { formatCounter } from '../src/philips/crypto.js';
import { AC2889, FakePhilips, createAll, createWorld, featureId, settle } from './helpers/world.js';

/** Everything written on stdout and stderr while `fn` runs, at `level`. */
async function capture(t, fn, level = 'info') {
  const lines = [];
  const previous = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = level;
  // Only the logger's lines ("[2026-...Z] [INFO] ..."); the rest (the test
  // reporter writes on stdout too) goes through.
  const original = { stdout: process.stdout.write, stderr: process.stderr.write };
  const writer = (stream) =>
    function write(chunk, ...rest) {
      const text = String(chunk);
      if (/^\[\d{4}-/.test(text)) {
        lines.push(...text.split('\n').filter(Boolean));
        return true;
      }
      return original[stream].call(process[stream], chunk, ...rest);
    };
  const stdout = t.mock.method(process.stdout, 'write', writer('stdout'));
  const stderr = t.mock.method(process.stderr, 'write', writer('stderr'));
  try {
    await fn();
  } finally {
    stdout.mock.restore();
    stderr.mock.restore();
    process.env.LOG_LEVEL = previous;
  }
  return lines;
}

async function createdWorld(t, options) {
  const world = await createWorld(options);
  t.after(() => world.app.stop());
  await createAll(world);
  return world;
}

const lastState = (world, key) => world.fake.lastState(featureId(world.gladys, AC2889, key));

test('logs: normal reads and pushes, with changes, write nothing at the info level', async (t) => {
  const device = new FakePhilips(AC2889, '192.0.2.10');
  const world = await createdWorld(t, { devices: [device] });
  const lines = await capture(t, async () => {
    for (const pm25 of [5, 8, 12, 12]) {
      device.status.pm25 = pm25;
      await world.hub.pollAll();
    }
    device.change({ iaql: 4 });
    await settle(world);
  });
  assert.equal(lastState(world, FEATURE_KEYS.PM25), 12);
  assert.deepEqual(lines, []);
});

test('logs: a command from the user is one line', async (t) => {
  const device = new FakePhilips(AC2889, '192.0.2.10');
  const world = await createdWorld(t, { devices: [device] });
  const purifier = world.fake.discoveredDevices[0];
  const lines = await capture(t, async () => {
    await world.fake.setValue(
      purifier,
      { external_id: featureId(world.gladys, AC2889, FEATURE_KEYS.MODE) },
      'sleep',
    );
    await settle(world);
  });
  assert.equal(lines.length, 1, lines.join('\n'));
  assert.match(lines[0], /\[INFO\].*Luftreiniger \(AC2889\/10\): mode set to sleep/);
});

test('logs: Gladys refusing the states is said once, and its return once', async (t) => {
  const device = new FakePhilips(AC2889, '192.0.2.10');
  const world = await createdWorld(t, { devices: [device] });
  const refusal = t.mock.method(world.gladys, 'publishChangedStates', async () => {
    throw new GladysApiError(503, 'SERVICE_UNAVAILABLE', 'Gladys is restarting');
  });
  const failing = await capture(t, async () => {
    for (const pm25 of [20, 30, 40, 50]) {
      device.status.pm25 = pm25;
      await world.hub.pollAll();
    }
    await world.hub.idle();
  });
  assert.equal(failing.length, 1, failing.join('\n'));
  assert.match(failing[0], /\[WARN\].*Gladys does not take the purifier updates/);

  refusal.mock.restore();
  const back = await capture(t, async () => {
    await world.hub.pollAll();
    await world.hub.pollAll();
  });
  assert.equal(back.length, 1, back.join('\n'));
  assert.match(back[0], /\[INFO\].*Gladys takes the purifier updates again/);
  assert.equal(lastState(world, FEATURE_KEYS.PM25), 50);
});

test('logs: a purifier going away and coming back is one line each way', async (t) => {
  const device = new FakePhilips(AC2889, '192.0.2.10');
  const world = await createdWorld(t, { devices: [device] });
  device.online = false;
  const away = await capture(t, async () => {
    for (let read = 0; read < 5; read += 1) {
      await world.hub.pollAll();
    }
  });
  assert.equal(away.length, 1, away.join('\n'));
  assert.match(away[0], /\[INFO\].*no longer answers at 192\.0\.2\.10/);
  device.online = true;
  const back = await capture(t, () => world.hub.pollAll());
  assert.equal(back.length, 1, back.join('\n'));
  assert.match(back[0], /\[INFO\].*answers again/);
});

test('logs: an address where nothing answers is said once', async (t) => {
  const device = new FakePhilips(AC2889, '192.0.2.10');
  device.online = false;
  const lines = await capture(t, async () => {
    const world = await createWorld({ devices: [device] });
    t.after(() => world.app.stop());
    for (let read = 0; read < 4; read += 1) {
      await world.hub.pollAll();
    }
  });
  const warnings = lines.filter((line) => line.includes('No Philips purifier answers'));
  assert.equal(warnings.length, 1, lines.join('\n'));
});

test('logs: no session key, decrypted status nor device id, even at the debug level', async (t) => {
  const device = new FakePhilips(AC2889, '192.0.2.10');
  const lines = await capture(
    t,
    async () => {
      const world = await createWorld({ devices: [device] });
      t.after(() => world.app.stop());
      await createAll(world);
      device.change({ pm25: 3 });
      await settle(world);
      device.refuse = 1;
      await world.hub.switchPower(world.fake.discoveredDevices[0].external_id, false);
      device.online = false;
      await world.hub.pollAll();
      await world.hub.pollAll();
    },
    'debug',
  );
  const text = lines.join('\n');
  assert.ok(lines.length > 0, 'the debug level shows the details');
  assert.ok(!text.includes(formatCounter(device.counter).slice(0, 6)), 'session counter');
  assert.ok(!text.includes(device.status.DeviceId), 'device id');
  assert.ok(!text.includes('"reported"'), 'decrypted status');
  assert.ok(!text.includes('JiangPan'));
});

test('polling: the hub reads by its own timer, without any onPoll', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const device = new FakePhilips(AC2889, '192.0.2.10');
  device.push = false;
  const world = await createdWorld(t, { devices: [device], timers: true });
  assert.ok(world.fake.discoveredDevices.every((purifier) => purifier.should_poll === false));
  const polls = t.mock.method(world.hub, 'refresh');

  device.status.pm25 = 42;
  t.mock.timers.tick(29_000);
  await world.hub.idle();
  assert.equal(polls.mock.callCount(), 0, 'not before the interval (30 s by default)');
  t.mock.timers.tick(1_000);
  await world.hub.idle();
  assert.equal(polls.mock.callCount(), 1);
  assert.equal(lastState(world, FEATURE_KEYS.PM25), 42);
});
