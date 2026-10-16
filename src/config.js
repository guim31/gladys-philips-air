// -----------------------------------------------------------------------------
// Integration configuration: defaults (they mirror the `default` values of the
// manifest `config_schema`, see test/manifest.test.js) and normalization, so
// the rest of the code never deals with strings, blanks or `undefined`.
// -----------------------------------------------------------------------------

import { COAP_PORT } from './philips/endpoint.js';

export const LANGUAGES = ['en', 'fr', 'de', 'es'];

// Seconds between two reads of every purifier (`poll_interval` options).
export const POLL_INTERVALS = [10, 15, 30, 60, 120];

// How many hours before the end of a replaceable filter the maintenance
// trigger fires (`filter_warning_hours` options).
export const FILTER_WARNINGS = [0, 24, 72, 168];

export const DEFAULT_CONFIG = {
  hosts: '',
  poll_interval: '30',
  filter_warning_hours: '0',
  language: 'fr',
};

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?::(\d{1,5}))?$/;
const MAX_HOSTS = 32;

/**
 * Parse the address list (commas, semicolons, spaces or new lines). IPv4
 * addresses only, with an optional port (a test device): the answers are
 * matched on the address they come from.
 * @param {unknown} raw
 * @returns {{ hosts: Array<{ host: string, port: number }>, invalid: string[] }}
 */
export function parseHosts(raw) {
  const hosts = [];
  const invalid = [];
  const entries = typeof raw === 'string' ? raw.split(/[\s,;]+/) : [];
  for (const entry of entries) {
    const text = entry.trim();
    if (!text) {
      continue;
    }
    const match = text.match(IPV4);
    const port = match?.[5] === undefined ? COAP_PORT : Number(match[5]);
    if (
      !match ||
      !match.slice(1, 5).every((part) => Number(part) <= 255) ||
      port < 1 ||
      port > 65535
    ) {
      invalid.push(text);
      continue;
    }
    // Leading zeros would make another string for the same address.
    const host = match.slice(1, 5).map(Number).join('.');
    if (!hosts.some((known) => known.host === host) && hosts.length < MAX_HOSTS) {
      hosts.push({ host, port });
    }
  }
  return { hosts, invalid };
}

const pick = (value, allowed, fallback) => {
  const number = Number(value);
  return allowed.includes(number) ? number : Number(fallback);
};

/**
 * @param {Record<string, unknown>} raw the configuration returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const { hosts, invalid } = parseHosts(
    typeof source.hosts === 'string' ? source.hosts : DEFAULT_CONFIG.hosts,
  );
  return {
    hosts,
    invalidHosts: invalid,
    pollSeconds: pick(source.poll_interval, POLL_INTERVALS, DEFAULT_CONFIG.poll_interval),
    filterWarningHours: pick(
      source.filter_warning_hours,
      FILTER_WARNINGS,
      DEFAULT_CONFIG.filter_warning_hours,
    ),
    language: LANGUAGES.includes(source.language) ? source.language : DEFAULT_CONFIG.language,
  };
}
