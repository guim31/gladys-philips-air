import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, normalizeConfig, parseHosts } from '../src/config.js';

test('config: the defaults', () => {
  assert.deepEqual(normalizeConfig(), {
    hosts: [],
    invalidHosts: [],
    pollSeconds: 30,
    filterWarningHours: 0,
    language: 'fr',
  });
  assert.equal(DEFAULT_CONFIG.language, 'fr');
});

test('config: addresses separated by commas, spaces or new lines, an optional port', () => {
  const { hosts, invalid } = parseHosts(
    '192.168.1.40, 192.168.001.41;\n192.168.1.40 10.0.0.5:5684 300.1.1.1 box.lan',
  );
  assert.deepEqual(hosts, [
    { host: '192.168.1.40', port: 5683 },
    { host: '192.168.1.41', port: 5683 },
    { host: '10.0.0.5', port: 5684 },
  ]);
  assert.deepEqual(invalid, ['300.1.1.1', 'box.lan']);
  assert.deepEqual(parseHosts('10.0.0.5:0').invalid, ['10.0.0.5:0']);
});

test('config: values outside the lists fall back to the defaults', () => {
  const config = normalizeConfig({
    poll_interval: '7',
    filter_warning_hours: '72',
    language: 'it',
    hosts: 42,
  });
  assert.equal(config.pollSeconds, 30);
  assert.equal(config.filterWarningHours, 72);
  assert.equal(config.language, 'fr');
  assert.deepEqual(config.hosts, []);
});
