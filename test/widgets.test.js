// -----------------------------------------------------------------------------
// The dashboard widget: content valid for the core (budget, vocabulary), its
// live tiles bound to features the device really has, its buttons.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { FEATURE_KEYS } from '../src/devices.js';
import { WIDGET_KEY } from '../src/hub.js';
import { allergenBand } from '../src/widgets.js';
import {
  AC2889,
  AC3829,
  FakePhilips,
  allDevices,
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

const content = async (world, settings, language = 'en') => {
  const ack = await world.fake.widgetGet(WIDGET_KEY, { settings, language, units: 'metric' });
  assert.equal(ack.success, true, ack.error);
  return ack.data.content;
};

test('widget: valid for every purifier and language, tiles bound to real features', async (t) => {
  const devices = allDevices();
  const world = await createdWorld(t, { devices });
  for (const purifier of world.fake.discoveredDevices) {
    const features = new Set(purifier.features.map((feature) => feature.external_id));
    for (const language of ['en', 'fr', 'de', 'es']) {
      const body = await content(world, { device: purifier.external_id }, language);
      assert.deepEqual(validateWidgetContent(body), [], `${purifier.name} ${language}`);
      for (const component of body.components.filter((c) => c.device_feature)) {
        assert.ok(features.has(component.device_feature), component.device_feature);
      }
      const keys = body.components.filter((c) => c.action).map((c) => c.action.key);
      assert.equal(new Set(keys).size, keys.length, 'action keys are unique');
    }
  }
});

test('widget: without a device, or an unknown one, says what to do', async (t) => {
  const world = await createdWorld(t);
  const empty = await content(world, {}, 'fr');
  assert.match(empty.components[0].text, /Choisissez un purificateur/);
  const unknown = await content(world, { device: 'ext:test-integration:purifier:ffff0000' });
  assert.match(unknown.components[0].text, /not known yet/);
});

test('widget: the allergen index on the Philips scale, the filter closest to its end', async (t) => {
  const device = new FakePhilips(AC2889, '192.0.2.10');
  device.status.iaql = 8;
  const world = await createdWorld(t, { devices: [device] });
  const body = await content(world, { device: deviceExternalId(world.gladys, AC2889) });
  const status = body.components.find((component) => component.type === 'status');
  assert.deepEqual(
    status.items.map((item) => [item.label, item.value]),
    [
      ['Mode', 'Manual'],
      ['Allergens', '8 · Poor'],
      ['Pre-filter', '149 h'],
    ],
  );
  assert.equal(allergenBand(2).color, 'success');
  assert.equal(allergenBand(12).color, 'danger');
});

test('widget: what the purifier asks for comes first; the empty tank is red', async (t) => {
  const device = new FakePhilips(AC3829, '192.0.2.10');
  const world = await createdWorld(t, { devices: [device] });
  device.change({ wl: 0, err: 49408 });
  await settle(world);
  const body = await content(world, { device: deviceExternalId(world.gladys, AC3829) }, 'fr');
  const maintenance = body.components.find((c) => c.type === 'status').items.at(-1);
  assert.equal(maintenance.value, "Réservoir d'eau vide");
  assert.equal(maintenance.color, 'danger');
  // The humidity tile is live.
  assert.ok(
    body.components.some(
      (c) => c.device_feature === featureId(world.gladys, AC3829, FEATURE_KEYS.HUMIDITY),
    ),
  );
});

test('widget: mode, boost and power buttons act on the purifier', async (t) => {
  const device = new FakePhilips(AC2889, '192.0.2.10');
  const world = await createdWorld(t, { devices: [device] });
  const settings = { device: deviceExternalId(world.gladys, AC2889), boost_minutes: '15' };
  const body = await content(world, settings);
  const buttons = body.components.filter((component) => component.type === 'button');
  assert.deepEqual(
    buttons.map((button) => button.label),
    ['Auto', 'Sleep', 'Boost 15 min', 'Turn off'],
  );

  let ack = await world.fake.widgetAction(WIDGET_KEY, 'mode_2', { mode: 'sleep' }, { settings });
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(device.controls.at(-1), { pwr: '1', mode: 'M', om: 's' });
  const after = await content(world, settings);
  assert.equal(after.components.find((c) => c.label === 'Sleep').icon, 'check-circle');

  ack = await world.fake.widgetAction(WIDGET_KEY, 'boost', {}, { settings });
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(device.controls.at(-1), { pwr: '1', mode: 'M', om: 't' });
  const boosting = await content(world, settings);
  assert.ok(
    boosting.components.find((c) => c.type === 'status').items.some((i) => i.label === 'Boost'),
  );

  ack = await world.fake.widgetAction(WIDGET_KEY, 'power', {}, { settings });
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(device.controls.at(-1), { pwr: '0' });
});
