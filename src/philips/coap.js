// -----------------------------------------------------------------------------
// The small part of CoAP (RFC 7252) the Philips devices speak, without a
// dependency: one datagram per message, a 4-byte header, a token, options
// encoded as deltas, then 0xFF and the payload. Observe (RFC 7641) and Block2
// (RFC 7959) are only options here; src/philips/endpoint.js gives them their
// meaning.
// -----------------------------------------------------------------------------

export const TYPES = { CON: 0, NON: 1, ACK: 2, RST: 3 };

export const CODES = {
  EMPTY: 0,
  GET: 1,
  POST: 2,
  CREATED: 65, // 2.01
  CHANGED: 68, // 2.04
  CONTENT: 69, // 2.05
};

export const OPTIONS = {
  URI_HOST: 3,
  OBSERVE: 6,
  URI_PATH: 11,
  CONTENT_FORMAT: 12,
  MAX_AGE: 14,
  URI_QUERY: 15,
  BLOCK2: 23,
  SIZE2: 28,
};

// Options whose value is a text (the others here are unsigned integers).
const STRING_OPTIONS = new Set([OPTIONS.URI_HOST, OPTIONS.URI_PATH, OPTIONS.URI_QUERY]);

const PAYLOAD_MARKER = 0xff;

export class CoapFormatError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CoapFormatError';
  }
}

/** "2.05" from 69: how CoAP writes a code. */
export function codeText(code) {
  return `${code >> 5}.${String(code & 0x1f).padStart(2, '0')}`;
}

/** An unsigned integer in the fewest bytes (zero is no byte at all). */
export function encodeUint(value) {
  const bytes = [];
  let rest = Math.max(0, Math.floor(Number(value) || 0));
  while (rest > 0) {
    bytes.unshift(rest & 0xff);
    rest = Math.floor(rest / 256);
  }
  return Buffer.from(bytes);
}

export function decodeUint(buffer) {
  let value = 0;
  for (const byte of buffer) {
    value = value * 256 + byte;
  }
  return value;
}

/** The value of a Block2 option: block number, more flag, block size. */
export function encodeBlock({ num, more = false, size }) {
  const szx = Math.log2(size) - 4;
  if (!Number.isInteger(szx) || szx < 0 || szx > 6) {
    throw new CoapFormatError(`Invalid block size ${size}`);
  }
  return num * 16 + (more ? 8 : 0) + szx;
}

export function decodeBlock(value) {
  return { num: Math.floor(value / 16), more: (value & 8) !== 0, size: 2 ** ((value & 7) + 4) };
}

// Delta and length nibbles: 0-12 inline, 13 and 14 announce 1 and 2 more bytes.
function nibble(value) {
  if (value < 13) {
    return { nibble: value, extra: Buffer.alloc(0) };
  }
  if (value < 269) {
    return { nibble: 13, extra: Buffer.from([value - 13]) };
  }
  const extra = Buffer.alloc(2);
  extra.writeUInt16BE(value - 269);
  return { nibble: 14, extra };
}

function optionValue(number, value) {
  if (Buffer.isBuffer(value)) {
    return value;
  }
  if (STRING_OPTIONS.has(number)) {
    return Buffer.from(String(value), 'utf8');
  }
  return encodeUint(value);
}

/**
 * One message as a datagram.
 * @param {object} message
 * @param {number} message.type TYPES
 * @param {number} message.code CODES
 * @param {number} message.messageId 0-65535
 * @param {Buffer} [message.token] 0-8 bytes
 * @param {Array<{number: number, value: number|string|Buffer}>} [message.options]
 * @param {Buffer|string} [message.payload]
 */
export function encode({ type, code, messageId, token = Buffer.alloc(0), options = [], payload }) {
  if (token.length > 8) {
    throw new CoapFormatError('A token holds 8 bytes at most');
  }
  const header = Buffer.alloc(4);
  header[0] = (1 << 6) | (type << 4) | token.length;
  header[1] = code;
  header.writeUInt16BE(messageId & 0xffff, 2);
  const parts = [header, token];
  let previous = 0;
  // Stable sort: repeated options (Uri-Path segments) keep their order.
  const sorted = options
    .map((option, index) => ({ ...option, index }))
    .sort((a, b) => a.number - b.number || a.index - b.index);
  for (const option of sorted) {
    const value = optionValue(option.number, option.value);
    const delta = nibble(option.number - previous);
    const length = nibble(value.length);
    parts.push(
      Buffer.from([(delta.nibble << 4) | length.nibble]),
      delta.extra,
      length.extra,
      value,
    );
    previous = option.number;
  }
  const body = payload === undefined || payload === null ? Buffer.alloc(0) : Buffer.from(payload);
  if (body.length > 0) {
    parts.push(Buffer.from([PAYLOAD_MARKER]), body);
  }
  return Buffer.concat(parts);
}

function readExtended(buffer, offset, value) {
  if (value < 13) {
    return { value, offset };
  }
  if (value === 13) {
    if (offset >= buffer.length) {
      throw new CoapFormatError('Truncated option');
    }
    return { value: buffer[offset] + 13, offset: offset + 1 };
  }
  if (value === 14) {
    if (offset + 2 > buffer.length) {
      throw new CoapFormatError('Truncated option');
    }
    return { value: buffer.readUInt16BE(offset) + 269, offset: offset + 2 };
  }
  throw new CoapFormatError('Reserved option nibble 15');
}

/**
 * A datagram as a message: `{ type, code, messageId, token, options, payload }`,
 * options as `[{ number, value: Buffer }]` in wire order.
 * @throws {CoapFormatError} for anything that is not CoAP version 1
 */
export function decode(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) {
    throw new CoapFormatError('Shorter than a CoAP header');
  }
  const version = buffer[0] >> 6;
  if (version !== 1) {
    throw new CoapFormatError(`CoAP version ${version}`);
  }
  const type = (buffer[0] >> 4) & 0x03;
  const tokenLength = buffer[0] & 0x0f;
  if (tokenLength > 8 || 4 + tokenLength > buffer.length) {
    throw new CoapFormatError('Invalid token length');
  }
  const message = {
    type,
    code: buffer[1],
    messageId: buffer.readUInt16BE(2),
    token: Buffer.from(buffer.subarray(4, 4 + tokenLength)),
    options: [],
    payload: Buffer.alloc(0),
  };
  let offset = 4 + tokenLength;
  let number = 0;
  while (offset < buffer.length) {
    const byte = buffer[offset];
    offset += 1;
    if (byte === PAYLOAD_MARKER) {
      if (offset >= buffer.length) {
        throw new CoapFormatError('Payload marker without payload');
      }
      message.payload = Buffer.from(buffer.subarray(offset));
      break;
    }
    const delta = readExtended(buffer, offset, byte >> 4);
    const length = readExtended(buffer, delta.offset, byte & 0x0f);
    offset = length.offset;
    if (offset + length.value > buffer.length) {
      throw new CoapFormatError('Truncated option value');
    }
    number += delta.value;
    message.options.push({
      number,
      value: Buffer.from(buffer.subarray(offset, offset + length.value)),
    });
    offset += length.value;
  }
  return message;
}

/** The first value of an option as an unsigned integer, or null. */
export function uintOption(message, number) {
  const option = message.options.find((candidate) => candidate.number === number);
  return option ? decodeUint(option.value) : null;
}

/** The Uri-Path of a request, "/sys/dev/status". */
export function uriPath(message) {
  const segments = message.options
    .filter((option) => option.number === OPTIONS.URI_PATH)
    .map((option) => option.value.toString('utf8'));
  return `/${segments.join('/')}`;
}

/** Uri-Path options of a path. */
export function pathOptions(path) {
  return path
    .split('/')
    .filter(Boolean)
    .map((segment) => ({ number: OPTIONS.URI_PATH, value: segment }));
}
