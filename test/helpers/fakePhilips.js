// -----------------------------------------------------------------------------
// A fake Philips purifier speaking the encrypted CoAP protocol, written after
// the test servers of py-air-control (rgerganov, MIT) and the exchanges of
// aioairctrl (kongo09, MIT):
//
//   POST /sys/dev/sync     → its counter, in clear text
//   GET  /sys/dev/status   → {"state":{"reported":...}}, encrypted; Observe 0
//                            registers the sender, Observe 1 ends it
//   POST /sys/dev/control  ← {"state":{"desired":...}}, encrypted, the counter
//                            above the last one taken → {"status":"success"}
//
// It knows nothing of the integration: it only reads and writes datagrams.
// `createNetwork(devices).createSocket` replaces dgram.createSocket in the
// tests; tools/fake-philips.mjs puts one on a real UDP port.
// -----------------------------------------------------------------------------

import { EventEmitter } from 'node:events';
import { readFileSync, readdirSync } from 'node:fs';
import {
  CODES,
  OPTIONS,
  TYPES,
  decode,
  decodeBlock,
  encode,
  encodeBlock,
  uintOption,
  uriPath,
} from '../../src/philips/coap.js';
import { decrypt, encryptWith, formatCounter } from '../../src/philips/crypto.js';

const FIXTURES = new URL('../fixtures/philips/', import.meta.url);

/** Every fixture, by file name without `.json`. */
export const FIXTURE_NAMES = readdirSync(FIXTURES)
  .filter((name) => name.endsWith('.json'))
  .map((name) => name.replace(/\.json$/, ''))
  .sort();

export function loadFixture(name) {
  return JSON.parse(readFileSync(new URL(`${name}.json`, FIXTURES), 'utf8')).status;
}

// Keys of a control message that are not settings.
const ENVELOPE = new Set(['CommandType', 'DeviceId', 'EnduserId']);

export class FakePhilips {
  /**
   * @param {string|object} fixture name of a fixture file, or a status
   * @param {string} host IPv4 address of the device
   * @param {number} [port]
   */
  constructor(fixture, host, port = 5683) {
    this.status = typeof fixture === 'string' ? loadFixture(fixture) : structuredClone(fixture);
    this.host = host;
    this.port = port;
    this.online = true;
    // Datagrams to ignore before answering again (UDP loss).
    this.drop = 0;
    // Commands to refuse with {"status":"failed"} (a stale session).
    this.refuse = 0;
    // Pushes to the observers, and whether they are confirmable.
    this.push = true;
    this.confirmable = false;
    // Status sent in blocks of this size (bytes), or whole.
    this.blockSize = null;
    this.counter = 0x1a2b3c00;
    this.lastClientCounter = null;
    this.observers = new Map();
    this.observeSeq = 2;
    this.messageId = 1000;
    this.received = [];
    this.controls = [];
    this.acks = 0;
    this.resets = 0;
    // Set by the network: how the device sends a datagram on its own.
    this.transmit = null;
  }

  nextId() {
    this.messageId = (this.messageId + 1) & 0xffff;
    return this.messageId;
  }

  /** The encrypted status payload, under a fresh counter of the device. */
  statusPayload() {
    this.counter = (this.counter + 1) >>> 0;
    return encryptWith(
      formatCounter(this.counter),
      JSON.stringify({ state: { reported: this.status }, desired: null }),
    );
  }

  /** How many requests of a path (and method) the device received. */
  count(path, code) {
    return this.received.filter(
      (request) => request.path === path && (code === undefined || request.code === code),
    ).length;
  }

  /**
   * One datagram from `remote`: the datagrams to answer (possibly none).
   * @returns {Buffer[]}
   */
  handle(buffer, remote) {
    let message;
    try {
      message = decode(buffer);
    } catch {
      return [];
    }
    if (message.code === CODES.EMPTY) {
      if (message.type === TYPES.ACK) {
        this.acks += 1;
      } else if (message.type === TYPES.RST) {
        this.resets += 1;
        this.observers.clear();
      }
      return [];
    }
    const path = uriPath(message);
    this.received.push({ path, code: message.code, remote });
    if (!this.online) {
      return [];
    }
    if (this.drop > 0) {
      this.drop -= 1;
      return [];
    }
    const reply = (code, payload, options = []) =>
      encode({
        type: message.type === TYPES.CON ? TYPES.ACK : TYPES.NON,
        code,
        messageId: message.type === TYPES.CON ? message.messageId : this.nextId(),
        token: message.token,
        options,
        payload,
      });

    if (path === '/sys/dev/sync' && message.code === CODES.POST) {
      return [reply(CODES.CONTENT, formatCounter(this.counter))];
    }
    if (path === '/sys/dev/status' && message.code === CODES.GET) {
      const observe = uintOption(message, OPTIONS.OBSERVE);
      const key = `${remote.address}:${remote.port}`;
      if (observe === 0) {
        this.observers.set(key, { remote, token: message.token });
      } else if (observe === 1) {
        this.observers.delete(key);
      }
      const block = uintOption(message, OPTIONS.BLOCK2);
      const payload = block === null ? this.statusPayload() : this.lastPayload;
      this.lastPayload = payload;
      const options = [{ number: OPTIONS.MAX_AGE, value: 60 }];
      if (observe === 0) {
        options.push({ number: OPTIONS.OBSERVE, value: this.observeSeq++ });
      }
      if (this.blockSize) {
        const num = block === null ? 0 : decodeBlock(block).num;
        const start = num * this.blockSize;
        const more = start + this.blockSize < payload.length;
        options.push({
          number: OPTIONS.BLOCK2,
          value: encodeBlock({ num, more, size: this.blockSize }),
        });
        return [reply(CODES.CONTENT, payload.slice(start, start + this.blockSize), options)];
      }
      return [reply(CODES.CONTENT, payload, options)];
    }
    if (path === '/sys/dev/control' && message.code === CODES.POST) {
      const text = message.payload.toString('utf8');
      let desired;
      try {
        desired = JSON.parse(decrypt(text)).state.desired;
      } catch {
        return [reply(CODES.CHANGED, '{"status":"failed"}')];
      }
      const counter = Number.parseInt(text.slice(0, 8), 16);
      const stale = this.lastClientCounter !== null && counter <= this.lastClientCounter;
      if (this.refuse > 0 || stale) {
        this.refuse = Math.max(0, this.refuse - 1);
        return [reply(CODES.CHANGED, '{"status":"failed"}')];
      }
      this.lastClientCounter = counter;
      const values = Object.fromEntries(
        Object.entries(desired).filter(([key]) => !ENVELOPE.has(key)),
      );
      this.controls.push(values);
      Object.assign(this.status, values);
      setImmediate(() => this.notify());
      return [reply(CODES.CHANGED, '{"status":"success"}')];
    }
    return [reply(132, undefined)]; // 4.04
  }

  /** Change the device as its buttons or the Philips app would, and push it. */
  change(values) {
    Object.assign(this.status, values);
    this.notify();
  }

  /** Send the status to every observer. */
  notify() {
    if (!this.push || !this.online || !this.transmit) {
      return;
    }
    for (const { remote, token } of this.observers.values()) {
      const options = [
        { number: OPTIONS.OBSERVE, value: this.observeSeq++ },
        { number: OPTIONS.MAX_AGE, value: 60 },
      ];
      const payload = this.statusPayload();
      if (this.blockSize && payload.length > this.blockSize) {
        options.push({
          number: OPTIONS.BLOCK2,
          value: encodeBlock({ num: 0, more: true, size: this.blockSize }),
        });
      }
      this.transmit(
        encode({
          type: this.confirmable ? TYPES.CON : TYPES.NON,
          code: CODES.CONTENT,
          messageId: this.nextId(),
          token,
          options,
          payload: this.blockSize ? payload.slice(0, this.blockSize) : payload,
        }),
        remote,
      );
    }
  }
}

/**
 * A UDP network of fake purifiers.
 * @param {FakePhilips[]} devices
 */
export function createNetwork(devices) {
  let nextPort = 40000;
  const network = {
    devices,
    sockets: [],
    byAddress: (host, port) =>
      network.devices.find((device) => device.host === host && device.port === port),
    createSocket() {
      const socket = new EventEmitter();
      socket.port = null;
      socket.bind = (port, callback) => {
        socket.port = port || nextPort++;
        setImmediate(callback);
      };
      socket.unref = () => socket;
      socket.closed = false;
      socket.close = () => {
        socket.closed = true;
      };
      socket.send = (data, port, host, callback) => {
        setImmediate(() => callback?.(null));
        const device = network.byAddress(host, port);
        if (!device) {
          return;
        }
        const remote = { address: '172.30.0.2', port: socket.port };
        for (const reply of device.handle(Buffer.from(data), remote)) {
          setImmediate(() => {
            if (!socket.closed) {
              socket.emit('message', reply, { address: device.host, port: device.port });
            }
          });
        }
      };
      network.sockets.push(socket);
      return socket;
    },
    /** Let a device push datagrams to the socket bound on the port of `remote`. */
    attach(device) {
      device.transmit = (datagram, remote) => {
        const socket = network.sockets.find((candidate) => candidate.port === remote.port);
        setImmediate(() => {
          if (socket && !socket.closed) {
            socket.emit('message', datagram, { address: device.host, port: device.port });
          }
        });
      };
    },
  };
  for (const device of devices) {
    network.attach(device);
  }
  return network;
}
