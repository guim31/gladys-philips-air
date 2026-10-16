// -----------------------------------------------------------------------------
// A session with one Philips purifier, over the shared CoAP endpoint:
//
//   POST /sys/dev/sync     a random 8-hex-digit nonce → the counter of the
//                          session (the "client key"), in clear text
//   GET  /sys/dev/status   Observe: 0 → {"state":{"reported":{...}}}, encrypted
//   POST /sys/dev/control  {"state":{"desired":{...}}}, encrypted →
//                          {"status":"success"} or {"status":"failed"}, clear
//
// Same exchanges as aioairctrl (kongo09, MIT). The status GET registers an
// observation under a token the session keeps: each later GET refreshes the
// same observation instead of piling new ones up on a firmware known to be
// fragile, and the device pushes its changes in between (`onStatus`). If the
// push does not get through, the next read brings the changes anyway.
//
// One exchange at a time per device. A failed command re-syncs once and is
// tried again, as aioairctrl does; a read without an answer drops the session,
// so the next one starts with a fresh sync.
// -----------------------------------------------------------------------------

import { randomBytes } from 'node:crypto';
import { CODES, OPTIONS, decodeBlock, uintOption } from './coap.js';
import { COAP_PORT, CoapError } from './endpoint.js';
import { DigestMismatchError, EncryptionContext, decrypt, isCounter, syncNonce } from './crypto.js';

export const PATHS = {
  SYNC: '/sys/dev/sync',
  STATUS: '/sys/dev/status',
  CONTROL: '/sys/dev/control',
};

export class PhilipsError extends Error {
  /**
   * @param {string} message
   * @param {'unreachable'|'protocol'|'refused'} kind
   */
  constructor(message, kind, options) {
    super(message, options);
    this.name = 'PhilipsError';
    this.kind = kind;
  }

  get unreachable() {
    return this.kind === 'unreachable';
  }
}

/** The reported state inside a status payload (decrypted JSON text). */
export function parseStatus(text) {
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new PhilipsError('The status is not JSON', 'protocol');
  }
  const reported = body?.state?.reported ?? body;
  if (!reported || typeof reported !== 'object' || Array.isArray(reported)) {
    throw new PhilipsError('The status has no reported state', 'protocol');
  }
  return reported;
}

/** Decrypt a status payload; an old firmware may answer in clear JSON. */
export function readStatusPayload(payload) {
  const text = payload.toString('utf8').trim();
  if (text.startsWith('{')) {
    return parseStatus(text);
  }
  try {
    return parseStatus(decrypt(text));
  } catch (err) {
    if (err instanceof DigestMismatchError) {
      throw new PhilipsError('The status could not be decrypted', 'protocol', { cause: err });
    }
    throw err;
  }
}

const wrap = (err, host) =>
  err instanceof CoapError
    ? new PhilipsError(
        err.unreachable ? `${host} does not answer` : err.message,
        err.unreachable ? 'unreachable' : 'protocol',
        { cause: err },
      )
    : err;

export class PhilipsClient {
  /**
   * @param {object} options
   * @param {import('./endpoint.js').CoapEndpoint} options.endpoint
   * @param {string} options.host IPv4 address
   * @param {number} [options.port]
   * @param {(status: object) => void} [options.onStatus] pushed statuses
   * @param {() => void} [options.onStale] a push too big to read: read again
   * @param {object} [options.logger]
   */
  constructor({ endpoint, host, port = COAP_PORT, onStatus, onStale, logger }) {
    this.endpoint = endpoint;
    this.host = host;
    this.port = port;
    this.onStatus = onStatus;
    this.onStale = onStale;
    this.logger = logger;
    this.context = null;
    // The token of this session's observation.
    this.token = randomBytes(4);
    this.stopObserving = null;
    this.queue = Promise.resolve();
    this.closed = false;
  }

  /** Run `task` after the exchanges already queued for this device. */
  serialize(task) {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => {});
    return run;
  }

  async sync() {
    let answer;
    try {
      answer = await this.endpoint.request({
        host: this.host,
        port: this.port,
        code: CODES.POST,
        path: PATHS.SYNC,
        payload: syncNonce(),
      });
    } catch (err) {
      throw wrap(err, this.host);
    }
    const counter = answer.payload.toString('utf8').trim().toUpperCase();
    if (!isCounter(counter)) {
      throw new PhilipsError(`${this.host} answered the sync with no key`, 'protocol');
    }
    this.context = new EncryptionContext(counter);
  }

  /** Forget the session: the next exchange starts with a sync. */
  reset() {
    this.context = null;
  }

  /** Read the status once (and refresh the observation). */
  getStatus() {
    return this.serialize(async () => {
      if (!this.context) {
        await this.sync();
      }
      this.follow();
      let answer;
      try {
        answer = await this.endpoint.request({
          host: this.host,
          port: this.port,
          code: CODES.GET,
          path: PATHS.STATUS,
          observe: 0,
          token: this.token,
        });
      } catch (err) {
        this.reset();
        throw wrap(err, this.host);
      }
      try {
        return readStatusPayload(answer.payload);
      } catch (err) {
        this.reset();
        throw err;
      }
    });
  }

  /** Listen to the notifications of this session's observation. */
  follow() {
    if (this.stopObserving || this.closed) {
      return;
    }
    this.stopObserving = this.endpoint.observe(this.host, this.token, (message) => {
      const block = uintOption(message, OPTIONS.BLOCK2);
      if (block !== null && decodeBlock(block).more) {
        // Only the first block came: the next read fetches the whole status.
        this.onStale?.();
        return;
      }
      let status;
      try {
        status = readStatusPayload(message.payload);
      } catch (err) {
        this.logger?.debug(`Ignored a notification of ${this.host}: ${err.message}`);
        return;
      }
      this.onStatus?.(status);
    });
  }

  /**
   * Change settings of the device.
   * @param {Record<string, unknown>} values Philips keys and values
   */
  setValues(values) {
    return this.serialize(async () => {
      const body = JSON.stringify({
        state: { desired: { CommandType: 'app', DeviceId: '', EnduserId: '', ...values } },
      });
      for (let attempt = 0; attempt < 2; attempt += 1) {
        if (!this.context || attempt > 0) {
          await this.sync();
        }
        let answer;
        try {
          answer = await this.endpoint.request({
            host: this.host,
            port: this.port,
            code: CODES.POST,
            path: PATHS.CONTROL,
            payload: this.context.encrypt(body),
          });
        } catch (err) {
          this.reset();
          throw wrap(err, this.host);
        }
        let result = null;
        try {
          result = JSON.parse(answer.payload.toString('utf8'));
        } catch {
          // Not JSON: treated as a refusal below.
        }
        if (result?.status === 'success') {
          return;
        }
        this.logger?.debug(`${this.host} refused a command (attempt ${attempt + 1})`);
      }
      throw new PhilipsError(`${this.host} refused the command`, 'refused');
    });
  }

  /** End the observation on the device (best effort) and stop listening. */
  async close() {
    this.closed = true;
    this.stopObserving?.();
    this.stopObserving = null;
    if (!this.context) {
      return;
    }
    try {
      await this.endpoint.exchange({
        host: this.host,
        port: this.port,
        code: CODES.GET,
        path: PATHS.STATUS,
        observe: 1,
        token: this.token,
        timeoutMs: 1_000,
      });
    } catch {
      // The device may be gone: its observation then expires by itself.
    }
  }
}
