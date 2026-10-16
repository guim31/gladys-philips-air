// -----------------------------------------------------------------------------
// A simulated Philips purifier on a real UDP port, to try the integration
// (or scripts/probe.mjs) without the hardware: it serves one fixture of
// test/fixtures/philips with the encrypted CoAP protocol, applies the
// commands, pushes its changes to the observers, and drifts its PM2.5 every
// 20 s so the pushes can be seen.
//
//   node tools/fake-philips.mjs classic-ac2889-10 [port]
//
// Not part of the image: a development tool only.
// -----------------------------------------------------------------------------

import dgram from 'node:dgram';
import { FIXTURE_NAMES, FakePhilips } from '../test/helpers/fakePhilips.js';

const [fixture, portArgument] = process.argv.slice(2);
if (!FIXTURE_NAMES.includes(fixture)) {
  console.error(`Usage: node tools/fake-philips.mjs <${FIXTURE_NAMES.join('|')}> [port]`);
  process.exit(2);
}
const port = Number(portArgument ?? 5683);
const device = new FakePhilips(fixture, '0.0.0.0', port);
const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

device.transmit = (datagram, remote) => socket.send(datagram, remote.port, remote.address);

socket.on('message', (message, remote) => {
  const before = device.controls.length;
  for (const reply of device.handle(message, remote)) {
    socket.send(reply, remote.port, remote.address);
  }
  const last = device.received.at(-1);
  if (last) {
    console.log(`${remote.address}:${remote.port} ${last.path}`);
  }
  if (device.controls.length > before) {
    console.log(`  applied ${JSON.stringify(device.controls.at(-1))}`);
  }
});

const pm25Key = ['pm25', 'D03-33', 'D03221'].find((key) => key in device.status);
setInterval(() => {
  if (pm25Key) {
    device.change({ [pm25Key]: 2 + Math.floor(Math.random() * 30) });
  }
}, 20_000).unref();

socket.bind(port, () => {
  console.log(`Fake Philips ${fixture} on UDP ${port}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    socket.close();
    process.exit(0);
  });
}
