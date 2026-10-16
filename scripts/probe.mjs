#!/usr/bin/env node
// -----------------------------------------------------------------------------
// Read-only probe of a real Philips purifier, with the very code of the
// integration (src/philips/): sync, one status read, then what the integration
// would make of it. It never sends a command, and registers no observation.
//
//   node scripts/probe.mjs 192.168.1.40 [port]
//
// Identifiers (DeviceId, ProductId, the name given in the app, serial-like
// values) are masked: the output can be pasted in an issue to add a model.
// -----------------------------------------------------------------------------

import { CODES } from '../src/philips/coap.js';
import { PATHS, PhilipsClient, readStatusPayload } from '../src/philips/client.js';
import { COAP_PORT, CoapEndpoint } from '../src/philips/endpoint.js';
import { capabilitiesOf, readingsOf } from '../src/philips/models.js';
import { parseHosts } from '../src/config.js';

// Keys that identify a device or its owner.
const MASKED = new Set([
  'DeviceId',
  'ProductId',
  'name',
  'D01-03',
  'D01S03',
  'filid',
  'macaddress',
  'ipaddress',
  'ssid',
  'cppid',
]);

const [address, portArgument] = process.argv.slice(2);
const { hosts } = parseHosts(portArgument ? `${address}:${portArgument}` : (address ?? ''));
if (hosts.length !== 1) {
  console.error('Usage: node scripts/probe.mjs <IPv4 address> [port]');
  process.exit(2);
}
const [{ host, port }] = hosts;

const mask = (status) =>
  Object.fromEntries(
    Object.entries(status).map(([key, value]) => [
      key,
      MASKED.has(key) && value !== '' ? `<masked ${typeof value}>` : value,
    ]),
  );

const endpoint = new CoapEndpoint({ timings: { timeoutMs: 8_000 } });
const client = new PhilipsClient({ endpoint, host, port });
try {
  console.log(`Philips purifier at ${host}:${port ?? COAP_PORT}`);
  await client.sync();
  console.log('- sync: answered with a session key');
  // A plain read, without Observe: nothing is left registered on the device.
  const answer = await endpoint.request({
    host,
    port,
    code: CODES.GET,
    path: PATHS.STATUS,
  });
  const status = readStatusPayload(answer.payload);
  console.log(`- status: ${Object.keys(status).length} keys`);
  const caps = capabilitiesOf(status);
  if (!caps) {
    console.log('- not a status this integration knows (no pwr / D03-02 / D03102 key)');
  } else {
    console.log(`- scheme: ${caps.scheme}, model: ${caps.model || '?'}`);
    console.log(
      caps.family
        ? `- family: ${caps.family} (modes: ${caps.modes.join(', ')}; speeds: ${caps.speeds})`
        : '- model not in the list: sensors and power only (please open an issue with this output)',
    );
    console.log(`- readings: ${JSON.stringify(readingsOf(status, caps))}`);
  }
  console.log('- raw status (identifiers masked):');
  console.log(JSON.stringify(mask(status), null, 2));
  process.exitCode = 0;
} catch (err) {
  console.error(`- failed: ${err.message}`);
  if (err.unreachable) {
    console.error(
      '  No answer on UDP. Check the address, that the purifier is on and connected to Wi-Fi,',
      'and that nothing filters UDP port 5683 between this machine and it.',
    );
  }
  process.exitCode = 1;
} finally {
  endpoint.close();
}
