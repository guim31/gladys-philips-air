// -----------------------------------------------------------------------------
// What each model reports and accepts (src/philips/models.js), on the
// fixtures: real statuses (py-air-control, aioairctrl) and reconstructed ones.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SCHEMES,
  UnsupportedError,
  capabilitiesOf,
  capabilityKeys,
  childLockCommand,
  deviceIdOf,
  displayCommand,
  familyOf,
  humidificationCommand,
  modeCommand,
  modelOf,
  nameOf,
  powerCommand,
  readingsOf,
  schemeOf,
  speedCommand,
  supportedModels,
  targetHumidityCommand,
} from '../src/philips/models.js';
import { FIXTURE_NAMES, loadFixture } from './helpers/fakePhilips.js';

const read = (name, changes = {}) => {
  const status = { ...loadFixture(name), ...changes };
  const caps = capabilitiesOf(status);
  return { status, caps, readings: readingsOf(status, caps) };
};

test('models: every fixture is recognized, with an identity', () => {
  for (const name of FIXTURE_NAMES) {
    const status = loadFixture(name);
    assert.ok(schemeOf(status), `${name}: scheme`);
    assert.match(deviceIdOf(status), /^[0-9a-f]{32}$/, `${name}: DeviceId`);
    assert.match(modelOf(status), /^(AC|HU)\d{4}\/\d\d$/, `${name}: model`);
    assert.ok(nameOf(status), `${name}: name`);
  }
});

test('models: AC2889 (real status) in manual speed 1', () => {
  const { caps, readings } = read('classic-ac2889-10');
  assert.equal(caps.scheme, SCHEMES.CLASSIC);
  assert.equal(caps.family, 'classic-pab');
  assert.deepEqual(caps.modes, ['auto', 'allergen', 'bacteria', 'sleep', 'turbo']);
  assert.equal(caps.speeds, 3);
  // No carbon filter: its type is "none".
  assert.deepEqual(caps.filters, ['pre-filter', 'hepa-filter']);
  assert.equal(caps.targetHumidity, null);
  assert.equal(caps.waterTank, false);
  assert.deepEqual(readings, {
    filters: { 'pre-filter': 149, 'hepa-filter': 4300 },
    power: true,
    mode: 'manual',
    speed: 1,
    pm25: 1,
    allergenIndex: 1,
    childLock: false,
    display: '25',
  });
});

test('models: sleep and turbo share the manual letter on the AC2889, told apart by the speed', () => {
  assert.equal(read('classic-ac2889-10', { mode: 'M', om: 's' }).readings.mode, 'sleep');
  assert.equal(read('classic-ac2889-10', { mode: 'M', om: 't' }).readings.mode, 'turbo');
  assert.equal(read('classic-ac2889-10', { mode: 'M', om: '3' }).readings.mode, 'manual');
  assert.equal(read('classic-ac2889-10', { mode: 'B' }).readings.mode, 'bacteria');
  // A child lock reported as text.
  assert.equal(read('classic-ac2889-10-prefilter').readings.childLock, false);
});

test('models: AC3829 humidifier in manual speed 2, humidifying', () => {
  const { caps, readings } = read('classic-ac3829-10');
  assert.equal(caps.family, 'classic-combo');
  assert.deepEqual(caps.targetHumidity, [40, 50, 60, 70]);
  assert.equal(caps.humidification, true);
  assert.equal(caps.waterTank, true);
  assert.deepEqual(caps.filters, ['pre-filter', 'hepa-filter', 'carbon-filter', 'wick']);
  assert.equal(readings.mode, 'manual');
  assert.equal(readings.speed, 2);
  assert.equal(readings.humidification, true);
  assert.equal(readings.waterEmpty, false);
  assert.equal(readings.targetHumidity, 50);
  // The S letter is sleep on this family.
  assert.equal(read('classic-ac3829-10', { mode: 'S', om: 's' }).readings.mode, 'sleep');
});

test('models: AC2729 (real statuses) with an empty water tank', () => {
  const night = read('classic-ac2729-50');
  assert.equal(night.readings.mode, 'sleep');
  assert.equal(night.readings.waterEmpty, true); // err 49408 "no water", wl 0
  const off = read('classic-ac2729-10');
  assert.equal(off.readings.power, false);
  assert.equal(off.readings.waterEmpty, true);
  assert.equal(off.readings.filters['pre-filter'], 0);
});

test('models: AC3858/50 (real status): no carbon filter (65535), 3000i modes', () => {
  const { caps, readings } = read('classic-ac3858-50');
  assert.equal(caps.family, 'classic-3000i');
  assert.deepEqual(caps.modes, ['auto', 'sleep', 'turbo']);
  assert.deepEqual(caps.filters, ['pre-filter', 'hepa-filter']);
  assert.equal(readings.power, false);
  assert.equal(readings.mode, 'auto');
  assert.equal(readings.allergenIndex, 7);
  // AC3858/51 has the allergy sleep too.
  assert.equal(familyOf(SCHEMES.CLASSIC, 'AC3858/51'), 'classic-3000i-as');
});

test('models: AC4236 in allergy sleep, 2000i in gentle', () => {
  assert.equal(read('classic-ac4236-10').readings.mode, 'allergy_sleep');
  const gentle = read('classic-ac2939-10');
  assert.equal(gentle.caps.speeds, 0);
  assert.equal(gentle.readings.mode, 'gentle');
  assert.equal(gentle.readings.speed, undefined);
});

test('models: AC0850 "AWS_Philips_AIR" firmware (real status)', () => {
  const { caps, readings } = read('air-ac0850-11');
  assert.equal(caps.scheme, SCHEMES.AIR);
  assert.equal(caps.family, 'air-ac0850');
  assert.deepEqual(caps.filters, ['hepa-filter'], 'its pre-filter counter never moves');
  assert.equal(caps.childLock, false);
  assert.deepEqual(readings, {
    filters: { 'hepa-filter': 3300 },
    power: true,
    mode: 'auto',
    pm25: 2,
    allergenIndex: 1,
  });
  assert.deepEqual(modeCommand(caps, 'turbo'), { 'D03-02': 'ON', 'D03-12': 'Turbo' });
  assert.deepEqual(powerCommand(caps, false), { 'D03-02': 'OFF' });
});

test('models: new generation purifier (AC2220) and humidifier (HU5710)', () => {
  const purifier = read('modern-ac2220-10');
  assert.equal(purifier.caps.scheme, SCHEMES.MODERN);
  assert.equal(purifier.caps.speeds, 5);
  assert.equal(purifier.readings.mode, 'auto');
  assert.equal(read('modern-ac2220-10', { D0310C: 3 }).readings.mode, 'manual');
  assert.equal(read('modern-ac2220-10', { D0310C: 3 }).readings.speed, 3);
  assert.deepEqual(speedCommand(purifier.caps, 4), { D03102: 1, D0310C: 4 });
  assert.deepEqual(childLockCommand(purifier.caps, true), { D03103: 1 });
  assert.deepEqual(displayCommand(purifier.caps, '0'), { D03105: 0 });

  const humidifier = read('modern-hu5710-10');
  assert.equal(humidifier.caps.family, 'modern-hu');
  assert.deepEqual(humidifier.caps.modes, ['auto', 'sleep', 'medium', 'high']);
  assert.equal(humidifier.readings.mode, 'sleep');
  assert.equal(humidifier.readings.temperature, 21.5, 'tenths of a degree');
  assert.equal(humidifier.readings.waterEmpty, true, 'bit 8 of D03240');
  assert.equal(humidifier.readings.targetHumidity, 55);
  assert.deepEqual(targetHumidityCommand(humidifier.caps, '45'), { D03128: 45 });
  assert.throws(() => targetHumidityCommand(humidifier.caps, 47), UnsupportedError);
});

test('models: classic commands carry the value types the firmware expects', () => {
  const { caps } = read('classic-ac3829-10');
  assert.deepEqual(powerCommand(caps, true), { pwr: '1' });
  assert.deepEqual(modeCommand(caps, 'sleep'), { pwr: '1', mode: 'S', om: 's' });
  assert.deepEqual(modeCommand(caps, 'turbo'), { pwr: '1', mode: 'M', om: 't' });
  assert.deepEqual(speedCommand(caps, 2), { pwr: '1', mode: 'M', om: '2' });
  assert.deepEqual(targetHumidityCommand(caps, '60'), { rhset: 60 });
  assert.deepEqual(humidificationCommand(caps, true), { func: 'PH' });
  assert.deepEqual(childLockCommand(caps, true), { cl: true });
  assert.deepEqual(displayCommand(caps, '75'), { aqil: 75 });
  assert.throws(() => modeCommand(caps, 'bacteria'), UnsupportedError);
  assert.throws(() => speedCommand(caps, 4), UnsupportedError);
});

test('models: a model missing from the list keeps its sensors, without modes', () => {
  const { caps, readings } = read('classic-unknown-ac9999');
  assert.equal(caps.family, null);
  assert.deepEqual(caps.modes, []);
  assert.equal(caps.speeds, 0);
  assert.equal(readings.mode, undefined);
  assert.equal(readings.pm25, 9);
  assert.deepEqual(
    caps.display.options.map((option) => option.value),
    ['0', '1'],
  );
  assert.throws(() => modeCommand(caps, 'auto'), UnsupportedError);
  assert.deepEqual(powerCommand(caps, false), { pwr: '0' });
});

test('models: the stored keys give the same capabilities as the full status', () => {
  for (const name of FIXTURE_NAMES) {
    const status = loadFixture(name);
    const skeleton = capabilityKeys(status);
    assert.deepEqual(capabilitiesOf(skeleton), capabilitiesOf(status), name);
    assert.equal(skeleton.DeviceId, undefined, 'no identifier stored twice');
  }
});

test('models: the families cover the models the integration announces', () => {
  const prefixes = supportedModels().map((model) => model.prefix);
  for (const model of ['AC2889', 'AC3829', 'AC3858/51', 'AC4236', 'AC2939', 'AC3033', 'HU5710']) {
    assert.ok(prefixes.includes(model), model);
  }
  assert.equal(schemeOf({ foo: 1 }), null);
  assert.equal(capabilitiesOf({ foo: 1 }), null);
});
