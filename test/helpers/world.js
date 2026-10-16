// -----------------------------------------------------------------------------
// A complete test world: the SDK's fake Gladys, fake purifiers on a fake UDP
// network, and a temporary /data, with the integration wired on top through
// registerHandlers. No timer runs unless asked: the tests read the purifiers
// with `world.hub.pollAll()`.
// -----------------------------------------------------------------------------

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../../src/app.js';
import { Store } from '../../src/store.js';
import { FIXTURE_NAMES, FakePhilips, createNetwork, loadFixture } from './fakePhilips.js';

// The integration logs every device found; keep the test output readable.
process.env.LOG_LEVEL ??= 'silent';

// Fast retries: a purifier that does not answer fails in 80 ms.
export const FAST_ENDPOINT = { timeoutMs: 80, retryMs: 30 };

export const AC2889 = 'classic-ac2889-10';
export const AC3829 = 'classic-ac3829-10';
export const AC0850 = 'air-ac0850-11';
export const HU5710 = 'modern-hu5710-10';
export const AC2220 = 'modern-ac2220-10';

/** One fake purifier per fixture, at 192.0.2.10, .11... */
export function allDevices() {
  return FIXTURE_NAMES.map((name, index) => new FakePhilips(name, `192.0.2.${10 + index}`));
}

/** The configuration `hosts` text of fake purifiers. */
export const hostsOf = (devices) =>
  devices
    .map((device) => (device.port === 5683 ? device.host : `${device.host}:${device.port}`))
    .join(', ');

/**
 * @param {object} [options]
 * @param {FakePhilips[]} [options.devices] the fake purifiers of the network
 * @param {object} [options.config] raw integration config (hosts default to the devices)
 * @param {Array} [options.created] devices already created in Gladys
 * @param {boolean} [options.timers] the hub's own timers (off: the tests poll)
 */
export async function createWorld({
  devices = [new FakePhilips(AC2889, '192.0.2.10')],
  config = {},
  created = [],
  connect = true,
  dataDir = mkdtempSync(join(tmpdir(), 'gladys-philips-air-')),
  timings = {},
  timers = false,
} = {}) {
  const network = createNetwork(devices);
  const gladys = createFakeGladys({
    config: { language: 'en', hosts: hostsOf(devices), ...config },
    devices: created,
  });
  const app = registerHandlers(gladys, {
    store: new Store(dataDir),
    createSocket: network.createSocket,
    timers,
    timings,
    endpointTimings: FAST_ENDPOINT,
  });
  if (connect) {
    await gladys.connect();
    await app.ready;
  }
  return { gladys, fake: gladys.fake, network, app, hub: app.hub, dataDir };
}

export const deviceIdOf = (fixture) => loadFixture(fixture).DeviceId;
export const deviceExternalId = (gladys, fixture) =>
  gladys.externalIds('purifier', deviceIdOf(fixture)).device;
export const featureId = (gladys, fixture, key) =>
  gladys.externalIds('purifier', deviceIdOf(fixture)).feature(key);

/** Add every discovered device in Gladys, as the user would. */
export async function createAll(world) {
  for (const device of world.fake.discoveredDevices) {
    await world.fake.deviceCreated(device);
  }
  await world.hub.idle();
}

/** Let the pending datagrams and handlers run. */
export async function settle(world, rounds = 5) {
  for (let round = 0; round < rounds; round += 1) {
    await new Promise((resolve) => setImmediate(resolve));
    await world.hub.idle();
  }
}

export { FakePhilips };
