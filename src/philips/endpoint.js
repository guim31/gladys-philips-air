// -----------------------------------------------------------------------------
// One UDP socket for every purifier, bound on an ephemeral port, speaking CoAP
// over it (src/philips/coap.js).
//
// - A request is a non-confirmable message (NON), like aioairctrl sends them,
//   sent again unchanged (same message id) until the answer or the deadline:
//   UDP loses datagrams, and the device drops the copies it already handled.
// - An answer is matched on its token and on the address it comes from.
// - A confirmable message of the device (CON) is acknowledged, or it would be
//   sent again and an observation dropped.
// - Observe (RFC 7641): the device keeps sending the status under the token of
//   the GET that registered it. A notification for a token nobody follows any
//   more is answered with a reset, which ends that observation on the device.
// - Block2 (RFC 7959): a status cut in blocks is fetched block by block.
//
// The bridge network of the Gladys sandbox lets this unicast traffic through
// in both directions (its NAT keeps the mapping while datagrams flow).
// -----------------------------------------------------------------------------

import dgram from 'node:dgram';
import { randomBytes, randomInt } from 'node:crypto';
import {
  CODES,
  OPTIONS,
  TYPES,
  codeText,
  decode,
  decodeBlock,
  encode,
  encodeBlock,
  pathOptions,
  uintOption,
} from './coap.js';

export const COAP_PORT = 5683;

export const ENDPOINT_TIMINGS = {
  // Total wait for an answer.
  timeoutMs: 6_000,
  // Delay before each copy of an unanswered request.
  retryMs: 1_500,
  // How long a message id stays known, to drop the copies the device resends.
  dedupMs: 120_000,
};

// More than 64 blocks of 1 KiB is not a purifier status.
const MAX_BLOCKS = 64;

export class CoapError extends Error {
  /**
   * @param {string} message
   * @param {'timeout'|'reset'|'socket'|'response'|'closed'} kind
   */
  constructor(message, kind) {
    super(message);
    this.name = 'CoapError';
    this.kind = kind;
  }

  /** The device did not answer at all (switched off, wrong address). */
  get unreachable() {
    return this.kind === 'timeout' || this.kind === 'socket';
  }
}

const tokenKey = (address, token) => `${address}|${token.toString('hex')}`;

const isResponseCode = (code) => code >> 5 >= 2;

export class CoapEndpoint {
  /**
   * @param {object} [options]
   * @param {() => object} [options.createSocket] test seam: a dgram-like socket
   * @param {object} [options.timings] ENDPOINT_TIMINGS overrides
   * @param {object} [options.logger]
   */
  constructor({ createSocket, timings, logger } = {}) {
    this.createSocket = createSocket ?? (() => dgram.createSocket('udp4'));
    this.timings = { ...ENDPOINT_TIMINGS, ...timings };
    this.logger = logger;
    this.socket = null;
    this.opening = null;
    this.messageId = randomInt(0, 0x10000);
    /** @type {Map<string, { resolve: Function }>} requests waiting, by address|token */
    this.pending = new Map();
    /** @type {Map<string, Function>} observation handlers, by address|token */
    this.observers = new Map();
    /** @type {Map<string, number>} message ids seen lately, by address:port:id */
    this.seen = new Map();
    this.closed = false;
  }

  nextMessageId() {
    this.messageId = (this.messageId + 1) & 0xffff;
    return this.messageId;
  }

  /** Bind the socket (once). */
  open() {
    if (this.closed) {
      return Promise.reject(new CoapError('The CoAP endpoint is closed', 'closed'));
    }
    if (this.socket) {
      return Promise.resolve();
    }
    this.opening ??= new Promise((resolve, reject) => {
      const socket = this.createSocket();
      const onError = (err) => {
        this.opening = null;
        reject(new CoapError(`Cannot open the UDP socket: ${err.message}`, 'socket'));
      };
      socket.once('error', onError);
      socket.bind(0, () => {
        socket.off('error', onError);
        socket.on('error', (err) => this.logger?.debug(`UDP socket error: ${err.message}`));
        socket.on('message', (data, remote) => this.receive(data, remote));
        // The socket alone never keeps the process alive.
        socket.unref?.();
        this.socket = socket;
        resolve();
      });
    });
    return this.opening;
  }

  close() {
    this.closed = true;
    for (const waiter of this.pending.values()) {
      waiter.resolve({ error: new CoapError('The CoAP endpoint is closed', 'closed') });
    }
    this.pending.clear();
    this.observers.clear();
    try {
      this.socket?.close();
    } catch {
      // Already closed.
    }
    this.socket = null;
  }

  send(buffer, port, address) {
    return new Promise((resolve) => {
      if (!this.socket) {
        resolve();
        return;
      }
      this.socket.send(buffer, port, address, (err) => {
        if (err) {
          this.logger?.debug(`Cannot send to ${address}:${port}: ${err.message}`);
        }
        resolve();
      });
    });
  }

  /** One incoming datagram. */
  receive(data, remote) {
    let message;
    try {
      message = decode(data);
    } catch (err) {
      this.logger?.debug(`Ignored a datagram from ${remote.address}: ${err.message}`);
      return;
    }
    if (message.type === TYPES.CON) {
      // Acknowledged even when it is a copy: the first ACK may be lost.
      this.send(
        encode({ type: TYPES.ACK, code: CODES.EMPTY, messageId: message.messageId }),
        remote.port,
        remote.address,
      );
    }
    if (message.code === CODES.EMPTY) {
      // An ACK of nothing we sent, or a reset of a request: a reset only
      // carries the message id, the waiting request times out.
      if (message.type === TYPES.RST) {
        this.resetOf(remote.address, message.messageId);
      }
      return;
    }
    if (this.isDuplicate(remote, message.messageId)) {
      return;
    }
    if (!isResponseCode(message.code)) {
      return;
    }
    const key = tokenKey(remote.address, message.token);
    const waiter = this.pending.get(key);
    if (waiter) {
      this.pending.delete(key);
      waiter.resolve({ message });
      return;
    }
    const observer = this.observers.get(key);
    if (observer) {
      try {
        observer(message);
      } catch (err) {
        this.logger?.debug(`Observation handler failed: ${err.message}`);
      }
      return;
    }
    if (uintOption(message, OPTIONS.OBSERVE) !== null && message.type !== TYPES.ACK) {
      // Nobody follows this observation any more: ask the device to stop it.
      this.send(
        encode({ type: TYPES.RST, code: CODES.EMPTY, messageId: message.messageId }),
        remote.port,
        remote.address,
      );
    }
  }

  isDuplicate(remote, messageId) {
    const now = Date.now();
    const key = `${remote.address}:${remote.port}:${messageId}`;
    const seenAt = this.seen.get(key);
    if (seenAt !== undefined && now - seenAt < this.timings.dedupMs) {
      return true;
    }
    this.seen.set(key, now);
    if (this.seen.size > 512) {
      for (const [old, at] of this.seen) {
        if (now - at >= this.timings.dedupMs || this.seen.size > 256) {
          this.seen.delete(old);
        }
      }
    }
    return false;
  }

  resetOf(address, messageId) {
    for (const [key, waiter] of this.pending) {
      if (waiter.address === address && waiter.messageId === messageId) {
        this.pending.delete(key);
        waiter.resolve({ error: new CoapError(`${address} refused the request`, 'reset') });
      }
    }
  }

  /**
   * Send one request and wait for its answer.
   * @param {object} request
   * @param {string} request.host IPv4 address
   * @param {number} [request.port]
   * @param {number} request.code CODES.GET or CODES.POST
   * @param {string} request.path
   * @param {string} [request.payload]
   * @param {number} [request.observe] 0 to register an observation, 1 to end it
   * @param {Buffer} [request.token]
   * @param {number} [request.block] Block2 number to ask for
   * @param {number} [request.blockSize]
   * @param {number} [request.timeoutMs]
   * @returns {Promise<object>} the answer (decoded message)
   */
  async exchange({
    host,
    port = COAP_PORT,
    code,
    path,
    payload,
    observe,
    token = randomBytes(4),
    block,
    blockSize,
    timeoutMs = this.timings.timeoutMs,
  }) {
    await this.open();
    const messageId = this.nextMessageId();
    const options = pathOptions(path);
    if (observe !== undefined) {
      options.push({ number: OPTIONS.OBSERVE, value: observe });
    }
    if (block !== undefined) {
      options.push({
        number: OPTIONS.BLOCK2,
        value: encodeBlock({ num: block, size: blockSize }),
      });
    }
    const datagram = encode({ type: TYPES.NON, code, messageId, token, options, payload });
    const key = tokenKey(host, token);

    let retry = null;
    let deadline = null;
    const answer = await new Promise((resolve) => {
      this.pending.set(key, { resolve, address: host, messageId });
      const sendCopy = () => {
        this.send(datagram, port, host);
        retry = setTimeout(sendCopy, this.timings.retryMs);
      };
      deadline = setTimeout(() => {
        if (this.pending.get(key)?.resolve === resolve) {
          this.pending.delete(key);
        }
        resolve({
          error: new CoapError(`No answer from ${host}:${port} on ${path}`, 'timeout'),
        });
      }, timeoutMs);
      sendCopy();
    }).finally(() => {
      clearTimeout(retry);
      clearTimeout(deadline);
    });
    if (answer.error) {
      throw answer.error;
    }
    const { message } = answer;
    if (message.type === TYPES.RST) {
      throw new CoapError(`${host} refused ${path}`, 'reset');
    }
    if (message.code >> 5 !== 2) {
      throw new CoapError(`${host} answered ${codeText(message.code)} on ${path}`, 'response');
    }
    return message;
  }

  /**
   * A request whose answer may come in blocks: resolves with the first
   * message, its payload being the whole of them.
   */
  async request(request) {
    const first = await this.exchange(request);
    const block2 = uintOption(first, OPTIONS.BLOCK2);
    if (block2 === null || !decodeBlock(block2).more) {
      return first;
    }
    const parts = [first.payload];
    let { num, more, size } = decodeBlock(block2);
    while (more) {
      if (parts.length >= MAX_BLOCKS) {
        throw new CoapError(`${request.host} sent too many blocks`, 'response');
      }
      const next = await this.exchange({
        host: request.host,
        port: request.port,
        code: CODES.GET,
        path: request.path,
        block: num + 1,
        blockSize: size,
        timeoutMs: request.timeoutMs,
      });
      const value = uintOption(next, OPTIONS.BLOCK2);
      if (value === null) {
        throw new CoapError(`${request.host} stopped sending blocks`, 'response');
      }
      ({ num, more, size } = decodeBlock(value));
      parts.push(next.payload);
    }
    return { ...first, payload: Buffer.concat(parts) };
  }

  /**
   * Follow the notifications sent under `token` by `host`.
   * @returns {() => void} stops following them
   */
  observe(host, token, handler) {
    const key = tokenKey(host, token);
    this.observers.set(key, handler);
    return () => {
      if (this.observers.get(key) === handler) {
        this.observers.delete(key);
      }
    };
  }
}
