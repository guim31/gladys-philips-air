// -----------------------------------------------------------------------------
// The Philips Air hub: reads the purifiers at the addresses of the
// configuration, publishes their devices and states to Gladys, runs the
// commands, fires the maintenance trigger and ends the boosts.
//
// Reading: the hub reads every purifier itself, every 30 s by default (its
// own timer: Gladys never polls these devices, should_poll is false). Each
// read also refreshes a CoAP observation, so a change made on the purifier or
// in the Philips app usually arrives at once, pushed by the device; when the
// push does not get through (it crosses the NAT of the Docker bridge, and the
// firmware is known to drop observations), the next read brings it anyway.
// -----------------------------------------------------------------------------

import { GladysApiError, createLogger } from '@gladysassistant/integration-sdk';
import {
  FEATURE_KEYS,
  buildDevice,
  commandFor,
  deviceIds,
  deviceName,
  deviceValues,
  featureSpecs,
} from './devices.js';
import { PhilipsClient } from './philips/client.js';
import {
  FILTERS,
  UnsupportedError,
  applyValues,
  capabilitiesOf,
  capabilityKeys,
  deviceIdOf,
  firmwareOf,
  modeCommand,
  nameOf,
  powerCommand,
  readingsOf,
  speedCommand,
} from './philips/models.js';
import { ProblemLog } from './problems.js';
import { CONNECTION_TEXT, MAINTENANCE_TEXT, maintenanceMessage } from './texts.js';

const logger = createLogger({ name: 'philips-air' });

export const WIDGET_KEY = 'purifier';
export const TRIGGER = 'maintenance_needed';
export const BOOST_ACTION = 'boost';

export const HUB_TIMINGS = {
  // Reads in a row without answer before a purifier is "unreachable".
  unreachableAfter: 2,
  // Unchanged values are sent again this often, so Gladys never shows them
  // as stale ("no recent value" comes after 48 h).
  heartbeatMs: 6 * 3600_000,
};

export const BOOST_MINUTES = { min: 5, max: 240, default: 30 };

const READ_CONCURRENCY = 4;
// Changes of these features change what the widget shows.
const WIDGET_KEYS = [
  FEATURE_KEYS.POWER,
  FEATURE_KEYS.MODE,
  FEATURE_KEYS.WATER_TANK,
  FEATURE_KEYS.ALLERGEN_INDEX,
];

const REPLACEABLE = [FILTERS.HEPA, FILTERS.CARBON, FILTERS.WICK];

const sameValue = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Gladys refused a call or did not answer: a passing condition, not a bug. */
const isGladysFailure = (err) =>
  err instanceof GladysApiError ||
  err?.name === 'TimeoutError' ||
  err?.name === 'AbortError' ||
  (err instanceof TypeError && err.message === 'fetch failed');

const describe = (err) => {
  const code = err?.cause?.code;
  return code && !err.message.includes(code) ? `${err.message} (${code})` : err.message;
};

/** Run `fn` over `items`, `limit` at a time; never rejects. */
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      try {
        results[index] = { value: await fn(items[index]) };
      } catch (error) {
        results[index] = { error };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export class PhilipsHub {
  /**
   * @param {object} options
   * @param {object} options.gladys GladysIntegration (or the SDK's fake)
   * @param {object} options.store persistence (src/store.js)
   * @param {import('./philips/endpoint.js').CoapEndpoint} options.endpoint
   * @param {boolean} [options.timers] periodic timers (off in tests)
   * @param {object} [options.timings] HUB_TIMINGS overrides
   */
  constructor({ gladys, store, endpoint, timers = true, timings }) {
    this.gladys = gladys;
    this.store = store;
    this.endpoint = endpoint;
    this.timersEnabled = timers;
    this.timings = { ...HUB_TIMINGS, ...timings };
    this.config = null;
    /** @type {Map<string, object>} purifiers, by DeviceId */
    this.records = new Map();
    /** @type {Map<string, object>} one link per configured address */
    this.links = new Map();
    /** @type {Map<string, object>} running boosts, by DeviceId */
    this.boosts = new Map();
    this.pending = new Set();
    this.pollTimer = null;
    this.polling = null;
    this.stopped = false;
    this.problems = new ProblemLog(logger);
  }

  // --- Lifecycle -------------------------------------------------------------

  async start(config) {
    this.config = config;
    await this.restore();
    this.syncLinks();
    await this.readAll();
    this.pruneRecords();
    await this.publishDevices();
    await this.publishAllStates();
    await this.publishTransports();
    await this.publishConnectionStatus();
    this.requestWidgetRefresh();
    this.startTimers();
  }

  /** Gladys came back (restart, network): it may have lost what was published. */
  async resync(config) {
    this.config = config;
    this.gladys.forgetPublishedStates();
    for (const record of this.records.values()) {
      record.published = {};
    }
    await this.publishDevices();
    await this.publishAllStates();
    await this.publishTransports();
    await this.publishConnectionStatus();
    this.gladysRecovered();
    this.requestWidgetRefresh();
  }

  async reconfigure(config) {
    const previous = this.config;
    this.config = config;
    this.syncLinks();
    await this.readAll();
    this.pruneRecords();
    await this.save();
    if (previous && previous.pollSeconds !== config.pollSeconds) {
      this.startTimers();
    }
    // New devices, or names in another language for the Discovery list.
    await this.publishDevices();
    await this.publishAllStates();
    await this.publishTransports();
    await this.publishConnectionStatus();
    this.requestWidgetRefresh();
  }

  startTimers() {
    if (!this.timersEnabled || this.stopped) {
      return;
    }
    clearInterval(this.pollTimer);
    this.pollTimer = setInterval(() => this.track(this.pollAll()), this.config.pollSeconds * 1000);
  }

  async stop() {
    this.stopped = true;
    clearInterval(this.pollTimer);
    for (const boost of this.boosts.values()) {
      clearTimeout(boost.timer);
    }
    await this.idle();
    await Promise.all([...this.links.values()].map((link) => link.client.close()));
    this.endpoint.close();
    await this.store.flush();
  }

  /** Keep track of background work, so the tests (and stop) can wait for it. */
  track(promise) {
    const tracked = Promise.resolve(promise)
      .catch((err) => this.backgroundFailed(err))
      .finally(() => this.pending.delete(tracked));
    this.pending.add(tracked);
    return tracked;
  }

  backgroundFailed(err) {
    if (isGladysFailure(err)) {
      this.problems.fail('gladys', `Gladys does not take the purifier updates: ${describe(err)}`);
    } else {
      this.problems.fail(`bug:${err?.message}`, 'Background task failed', 'error', err);
    }
  }

  gladysRecovered() {
    this.problems.recover('gladys', 'Gladys takes the purifier updates again');
  }

  async idle() {
    while (this.pending.size > 0) {
      await Promise.all([...this.pending]);
    }
  }

  // --- Persistence -----------------------------------------------------------

  async restore() {
    const data = await this.store.load();
    for (const [deviceId, saved] of Object.entries(data.devices ?? {})) {
      const caps = saved?.keys ? capabilitiesOf(saved.keys) : null;
      if (!caps || typeof saved.host !== 'string' || !/^[0-9a-f]{8,64}$/.test(deviceId)) {
        continue;
      }
      const record = this.createRecord(deviceId, saved.host, saved.port);
      Object.assign(record, {
        name: typeof saved.name === 'string' ? saved.name : '',
        firmware: typeof saved.firmware === 'string' ? saved.firmware : null,
        keys: saved.keys,
        caps,
      });
      record.alerts = new Set(Array.isArray(saved.alerts) ? saved.alerts : []);
      this.records.set(deviceId, record);
    }
    for (const [deviceId, saved] of Object.entries(data.boosts ?? {})) {
      if (this.records.has(deviceId) && Number.isFinite(saved?.until)) {
        this.scheduleBoost(deviceId, { until: saved.until, restore: saved.restore ?? {} });
      }
    }
  }

  save() {
    const devices = {};
    for (const record of this.records.values()) {
      devices[record.deviceId] = {
        host: record.host,
        port: record.port,
        name: record.name,
        firmware: record.firmware,
        keys: record.keys,
        alerts: [...record.alerts],
      };
    }
    const boosts = {};
    for (const [deviceId, boost] of this.boosts) {
      boosts[deviceId] = { until: boost.until, restore: boost.restore };
    }
    return this.store.save({ devices, boosts });
  }

  // --- Addresses and devices ---------------------------------------------------

  createRecord(deviceId, host, port) {
    return {
      deviceId,
      host,
      port,
      name: '',
      firmware: null,
      keys: null,
      caps: null,
      status: null,
      readings: null,
      // null until the first answer or the first read without one.
      reachable: null,
      // Bumped on every command: a read started before it is stale.
      commandSeq: 0,
      alerts: new Set(),
      // Last values published, by feature key (for the widget nudges).
      published: {},
    };
  }

  /** One link (CoAP session) per configured address; the removed ones close. */
  syncLinks() {
    const wanted = new Map(
      this.config.hosts.map((entry) => [`${entry.host}:${entry.port}`, entry]),
    );
    for (const [key, link] of this.links) {
      if (!wanted.has(key)) {
        link.client.close();
        this.links.delete(key);
      }
    }
    for (const [key, { host, port }] of wanted) {
      if (this.links.has(key)) {
        continue;
      }
      const link = { key, host, port, deviceId: null, failures: 0, answered: null };
      link.client = new PhilipsClient({
        endpoint: this.endpoint,
        host,
        port,
        logger,
        onStatus: (status) => this.track(this.applyStatus(link, status, { pushed: true })),
        onStale: () => this.track(this.refresh(link)),
      });
      // A known purifier at this address keeps its identity until it answers.
      for (const record of this.records.values()) {
        if (record.host === host && record.port === port) {
          link.deviceId = record.deviceId;
        }
      }
      this.links.set(key, link);
    }
  }

  /**
   * Purifiers no configured address answers for leave the list. Run after
   * reading the addresses: a purifier given a new address keeps its record
   * (alerts already fired, boost).
   */
  pruneRecords() {
    for (const deviceId of [...this.records.keys()]) {
      if (![...this.links.values()].some((link) => link.deviceId === deviceId)) {
        this.records.delete(deviceId);
        this.cancelBoost(deviceId);
      }
    }
  }

  linkOf(record) {
    return [...this.links.values()].find((link) => link.deviceId === record.deviceId) ?? null;
  }

  async publishDevices() {
    const devices = [...this.records.values()]
      .filter((record) => record.caps)
      .map((record) => buildDevice(this.gladys, record, this.config.language));
    await this.gladys.publishDiscoveredDevices(devices);
  }

  /** The record behind a Gladys device external id, or null. */
  resolveDevice(externalId) {
    if (typeof externalId !== 'string') {
      return null;
    }
    const prefix = deviceIds(this.gladys, '').device;
    if (!externalId.startsWith(prefix)) {
      return null;
    }
    return this.records.get(externalId.slice(prefix.length)) ?? null;
  }

  require(externalId) {
    const record = this.resolveDevice(externalId);
    if (!record?.caps) {
      throw new Error(`Unknown Philips purifier ${externalId}`);
    }
    return record;
  }

  isCreated(record) {
    const id = deviceIds(this.gladys, record.deviceId).device;
    return (this.gladys.devices ?? []).some((device) => device.external_id === id);
  }

  label(record) {
    return deviceName(record);
  }

  // --- Reading ---------------------------------------------------------------

  async readAll() {
    await mapLimit([...this.links.values()], READ_CONCURRENCY, (link) => this.refresh(link));
  }

  /** Read every purifier once (the timer's job). */
  pollAll() {
    this.polling ??= mapLimit([...this.links.values()], READ_CONCURRENCY, (link) =>
      this.refresh(link),
    )
      .then((results) => {
        const errors = results.filter((result) => result.error).map((result) => result.error);
        errors.forEach((err) => this.backgroundFailed(err));
        if (errors.length === 0) {
          this.gladysRecovered();
        }
      })
      .finally(() => {
        this.polling = null;
      });
    return this.polling;
  }

  /** Read one address and publish what changed. */
  async refresh(link) {
    const record = link.deviceId ? this.records.get(link.deviceId) : null;
    const seq = record?.commandSeq;
    let status;
    try {
      status = await link.client.getStatus();
    } catch (err) {
      if (this.stopped) {
        return;
      }
      if (err.unreachable) {
        await this.linkFailed(link);
      } else {
        this.problems.fail(`read:${link.key}`, `Cannot read ${link.host}: ${err.message}`);
      }
      return;
    }
    this.problems.recover(`read:${link.key}`, `${link.host} reads again`);
    if (record && seq !== record.commandSeq) {
      // A Gladys command ran meanwhile: this status may predate it.
      return;
    }
    await this.applyStatus(link, status);
  }

  /** A status read or pushed: identity, capabilities, states, alerts. */
  async applyStatus(link, status, { pushed = false } = {}) {
    if (this.stopped) {
      return;
    }
    const deviceId = deviceIdOf(status);
    const caps = capabilitiesOf(status);
    if (!deviceId || !caps) {
      this.problems.fail(
        `identity:${link.key}`,
        `${link.host} answered a status this integration does not know (no DeviceId or unknown keys)`,
      );
      return;
    }
    this.problems.recover(`identity:${link.key}`, `${link.host} answers a known status again`);
    link.failures = 0;
    link.answered = true;
    this.problems.recover(`host:${link.key}`, `A purifier answers at ${link.host} again`);

    let record = this.records.get(deviceId);
    let structureChanged = false;
    if (!record) {
      record = this.createRecord(deviceId, link.host, link.port);
      this.records.set(deviceId, record);
      logger.info(`Philips ${caps.model || 'purifier'} found at ${link.host}`);
      if (!caps.family) {
        logger.warn(
          `Philips ${caps.model || 'purifier'} is not in the model list: sensors and power only (scripts/probe.mjs shows its status)`,
        );
      }
      structureChanged = true;
    } else if (record.host !== link.host || record.port !== link.port) {
      logger.info(`${this.label(record)} moved from ${record.host} to ${link.host}`);
      structureChanged = true;
    }
    // Another address answered for this purifier before: it is this one now.
    for (const other of this.links.values()) {
      if (other !== link && other.deviceId === deviceId) {
        other.deviceId = null;
      }
    }
    link.deviceId = deviceId;
    record.host = link.host;
    record.port = link.port;
    const name = nameOf(status);
    const firmware = firmwareOf(status);
    const keys = capabilityKeys(status);
    if (!sameValue(record.caps, caps) || record.name !== name || record.firmware !== firmware) {
      structureChanged = true;
    }
    Object.assign(record, { name, firmware, keys, caps, status: { ...status } });
    record.readings = readingsOf(record.status, caps);

    if (structureChanged) {
      await this.save();
      await this.publishDevices();
    }
    if (record.reachable !== true) {
      const cameBack = record.reachable === false;
      record.reachable = true;
      if (cameBack) {
        logger.info(`${this.label(record)} answers again at ${link.host}`);
      }
      await this.publishTransports([record]);
      await this.publishConnectionStatus();
      this.requestWidgetRefresh();
    }
    if (pushed) {
      logger.debug(`${this.label(record)} pushed its status`);
    }
    const changed = await this.publishStates(record);
    if (changed.some((key) => WIDGET_KEYS.includes(key))) {
      this.requestWidgetRefresh();
    }
    await this.checkMaintenance(record);
    await this.checkBoost(record);
  }

  /** A read without answer; after a few in a row, the purifier is unreachable. */
  async linkFailed(link) {
    link.failures += 1;
    if (link.failures < this.timings.unreachableAfter) {
      return;
    }
    const record = link.deviceId ? this.records.get(link.deviceId) : null;
    if (!record) {
      if (link.answered !== false) {
        link.answered = false;
        this.problems.fail(
          `host:${link.key}`,
          `No Philips purifier answers at ${link.host} (UDP ${link.port})`,
        );
        await this.publishConnectionStatus();
      }
      return;
    }
    if (record.reachable === false) {
      return;
    }
    const known = record.reachable === true;
    record.reachable = false;
    if (known) {
      logger.info(`${this.label(record)} no longer answers at ${link.host}`);
    } else {
      logger.debug(`${this.label(record)} does not answer at ${link.host} yet`);
    }
    await this.publishTransports([record]);
    await this.publishConnectionStatus();
    this.requestWidgetRefresh();
  }

  // --- States ----------------------------------------------------------------

  /**
   * Publish what changed for one purifier, if the user created it. Resolves
   * with the keys that changed.
   */
  async publishStates(record) {
    if (!record.caps || !record.readings || !this.isCreated(record)) {
      return [];
    }
    const ids = deviceIds(this.gladys, record.deviceId);
    const values = deviceValues(record.caps, record.readings);
    const states = [];
    const changed = [];
    for (const spec of featureSpecs(record.caps, this.config.language)) {
      const value = values[spec.key];
      if (value === undefined) {
        continue;
      }
      states.push(
        typeof value === 'object'
          ? { device_feature_external_id: ids.feature(spec.key), text: value.text }
          : { device_feature_external_id: ids.feature(spec.key), state: value },
      );
      if (!sameValue(record.published[spec.key], value)) {
        changed.push(spec.key);
      }
    }
    // The SDK sends only the values that changed (and the heartbeat).
    await this.gladys.publishChangedStates(states, { heartbeat: this.timings.heartbeatMs });
    for (const key of changed) {
      record.published[key] = values[key];
    }
    return changed;
  }

  async publishAllStates() {
    for (const record of this.records.values()) {
      try {
        await this.publishStates(record);
      } catch (err) {
        this.backgroundFailed(err);
      }
    }
  }

  /**
   * The user added a device: the states sent before were dropped by Gladys,
   * and so was the transport badge. Send them again, nudge the widget.
   */
  async onDeviceCreated(device) {
    const record = this.resolveDevice(device?.external_id);
    if (!record) {
      return;
    }
    record.published = {};
    this.gladys.forgetPublishedStates(device.external_id);
    await this.publishStates(record);
    await this.publishTransports([record]);
    await this.checkMaintenance(record);
    this.requestWidgetRefresh();
  }

  async publishTransports(records = [...this.records.values()]) {
    const entries = records
      .filter((record) => this.isCreated(record))
      .map((record) => ({
        external_id: deviceIds(this.gladys, record.deviceId).device,
        transport: record.reachable === true ? 'local' : 'unreachable',
      }));
    for (let at = 0; at < entries.length; at += 100) {
      await this.gladys.publishTransports(entries.slice(at, at + 100));
    }
  }

  async publishConnectionStatus() {
    if (this.config.hosts.length === 0) {
      await this.gladys.setConnectionStatus(false, CONNECTION_TEXT.noHost);
    } else if (![...this.records.values()].some((record) => record.reachable === true)) {
      await this.gladys.setConnectionStatus(false, CONNECTION_TEXT.noAnswer);
    } else {
      await this.gladys.setConnectionStatus(true);
    }
  }

  requestWidgetRefresh() {
    this.gladys.requestWidgetRefresh(WIDGET_KEY);
  }

  // --- Maintenance trigger ---------------------------------------------------------

  /** What the purifier asks for now: item → hours left (0 for the water). */
  maintenanceOf(record) {
    const items = new Map();
    const readings = record.readings ?? { filters: {} };
    for (const [filter, hours] of Object.entries(readings.filters ?? {})) {
      // A pre-filter is cleaned every few weeks: only when the purifier asks.
      const threshold = REPLACEABLE.includes(filter) ? this.config.filterWarningHours : 0;
      if (hours <= threshold) {
        items.set(filter, Math.max(0, Math.round(hours)));
      }
    }
    if (readings.waterEmpty === true && readings.humidification !== false) {
      items.set('water-tank', 0);
    }
    return items;
  }

  /**
   * Fire the trigger once per item the purifier starts asking for; an item
   * done (filter replaced, tank filled) re-arms it.
   */
  async checkMaintenance(record) {
    if (!record.readings || !this.isCreated(record)) {
      return;
    }
    const now = this.maintenanceOf(record);
    let dirty = false;
    for (const item of [...record.alerts]) {
      if (!now.has(item)) {
        record.alerts.delete(item);
        dirty = true;
      }
    }
    for (const [item, hours] of now) {
      if (record.alerts.has(item)) {
        continue;
      }
      record.alerts.add(item);
      dirty = true;
      logger.info(`${this.label(record)}: ${MAINTENANCE_TEXT.en[item]}`);
      this.track(
        this.gladys.publishSceneEvent(TRIGGER, {
          device: deviceIds(this.gladys, record.deviceId).device,
          item,
          hours_left: hours,
          message: maintenanceMessage(this.label(record), item, hours, this.config.language),
        }),
      );
    }
    if (dirty) {
      await this.save();
      this.requestWidgetRefresh();
    }
  }

  // --- Commands ----------------------------------------------------------------

  /** Send Philips keys, then show their effect without waiting for a read. */
  async send(record, values) {
    const link = this.linkOf(record);
    if (!link) {
      throw new Error(`${this.label(record)} has no address in the configuration`);
    }
    record.commandSeq += 1;
    try {
      await link.client.setValues(values);
    } catch (err) {
      if (err.unreachable) {
        await this.linkFailed(link);
      }
      throw new Error(`${this.label(record)}: ${err.message}`, { cause: err });
    }
    record.status = applyValues(record.status ?? {}, values);
    record.readings = readingsOf(record.status, record.caps);
    const changed = await this.publishStates(record);
    if (changed.some((key) => WIDGET_KEYS.includes(key))) {
      this.requestWidgetRefresh();
    }
  }

  /** A Gladys command on a feature of one of the purifiers. */
  async setValue(device, feature, value) {
    const record = this.require(device?.external_id);
    const prefix = `${device.external_id}:`;
    const key = feature?.external_id?.startsWith(prefix)
      ? feature.external_id.slice(prefix.length)
      : null;
    const values = commandFor(record, key, value);
    logger.info(`${this.label(record)}: ${key} set to ${value}`);
    await this.send(record, values);
  }

  /** Switch a purifier on or off (the widget's button). */
  async switchPower(deviceExternalId, on) {
    const record = this.require(deviceExternalId);
    logger.info(`${this.label(record)}: switched ${on ? 'on' : 'off'}`);
    await this.send(record, powerCommand(record.caps, on));
  }

  /** Set a mode (the widget's buttons). */
  async setMode(deviceExternalId, mode) {
    const record = this.require(deviceExternalId);
    logger.info(`${this.label(record)}: mode set to ${mode}`);
    await this.send(record, modeCommand(record.caps, mode));
  }

  // --- Boost -------------------------------------------------------------------

  /** What a boost runs: turbo, or the highest manual speed. */
  boostTarget(record) {
    if (record.caps.modes.includes('turbo')) {
      return { mode: 'turbo', values: modeCommand(record.caps, 'turbo') };
    }
    if (record.caps.speeds > 0) {
      return {
        speed: record.caps.speeds,
        values: speedCommand(record.caps, record.caps.speeds),
      };
    }
    throw new UnsupportedError(`${this.label(record)} has no turbo mode`);
  }

  /**
   * Run the purifier at full speed for `minutes`, then put it back as it was
   * (off, or its mode), unless someone changed it meanwhile.
   * @returns {Date} the end of the boost
   */
  async startBoost(deviceExternalId, minutes) {
    const record = this.require(deviceExternalId);
    const duration = Math.round(Number(minutes));
    if (
      !Number.isFinite(duration) ||
      duration < BOOST_MINUTES.min ||
      duration > BOOST_MINUTES.max
    ) {
      throw new Error(`The boost lasts ${BOOST_MINUTES.min} to ${BOOST_MINUTES.max} minutes`);
    }
    const target = this.boostTarget(record);
    const running = this.boosts.get(record.deviceId);
    // A boost during a boost extends it and keeps the state from before.
    const restore = running?.restore ?? {
      power: record.readings?.power ?? null,
      mode: record.readings?.mode ?? null,
      speed: record.readings?.speed ?? null,
    };
    logger.info(`${this.label(record)}: boost for ${duration} min`);
    await this.send(record, target.values);
    const until = Date.now() + duration * 60_000;
    this.scheduleBoost(record.deviceId, { until, restore });
    await this.save();
    this.requestWidgetRefresh();
    return new Date(until);
  }

  scheduleBoost(deviceId, { until, restore }) {
    this.cancelBoost(deviceId);
    const boost = { until, restore, timer: null, due: false };
    this.boosts.set(deviceId, boost);
    if (!this.timersEnabled) {
      return;
    }
    const delay = Math.max(0, until - Date.now());
    // setTimeout holds 24.8 days at most; a boost lasts 4 hours.
    boost.timer = setTimeout(() => {
      boost.due = true;
      const record = this.records.get(deviceId);
      if (record) {
        this.track(this.endBoost(record));
      }
    }, delay);
    boost.timer.unref?.();
  }

  cancelBoost(deviceId) {
    const boost = this.boosts.get(deviceId);
    if (boost) {
      clearTimeout(boost.timer);
      this.boosts.delete(deviceId);
    }
  }

  isBoosting(record) {
    return this.boosts.has(record.deviceId);
  }

  /** A boost past its end (missed while the purifier was away): end it now. */
  async checkBoost(record) {
    const boost = this.boosts.get(record.deviceId);
    if (boost && (boost.due || Date.now() >= boost.until)) {
      await this.endBoost(record);
    }
  }

  /** End a boost: back to the state from before, if the boost still runs. */
  async endBoost(record) {
    const boost = this.boosts.get(record.deviceId);
    if (!boost || boost.ending) {
      return;
    }
    if (record.reachable !== true) {
      // Ended at the next answer (checkBoost).
      boost.due = true;
      return;
    }
    boost.ending = true;
    try {
      const target = this.boostTarget(record);
      const readings = record.readings ?? {};
      const stillBoosting =
        readings.power !== false &&
        (target.mode ? readings.mode === target.mode : readings.speed === target.speed);
      if (stillBoosting) {
        const { restore } = boost;
        let values = null;
        if (restore.power === false) {
          values = powerCommand(record.caps, false);
        } else if (restore.mode === 'manual' && restore.speed) {
          values = speedCommand(record.caps, restore.speed);
        } else if (restore.mode && record.caps.modes.includes(restore.mode)) {
          values = modeCommand(record.caps, restore.mode);
        }
        if (values) {
          logger.info(`${this.label(record)}: boost over, back to the previous state`);
          await this.send(record, values);
        }
      } else {
        logger.debug(`${this.label(record)}: boost over, changed meanwhile, left as it is`);
      }
    } catch (err) {
      boost.ending = false;
      boost.due = true;
      throw err;
    }
    this.cancelBoost(record.deviceId);
    await this.save();
    this.requestWidgetRefresh();
  }

  // --- Check action ------------------------------------------------------------

  /** Read every address now; what the "Check the purifiers" action reports. */
  async check() {
    await this.readAll();
    await this.publishDevices();
    await this.publishTransports();
    await this.publishConnectionStatus();
    this.requestWidgetRefresh();
    return {
      invalidHosts: this.config.invalidHosts,
      hosts: [...this.links.values()].map((link) => {
        const record = link.deviceId ? this.records.get(link.deviceId) : null;
        return {
          host: link.host,
          label: record ? this.label(record) : null,
          reachable: record?.reachable === true && link.failures === 0,
          known: Boolean(record?.caps?.family),
        };
      }),
    };
  }
}
