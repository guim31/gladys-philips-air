// -----------------------------------------------------------------------------
// What a Philips purifier reports, and what it accepts, by model.
//
// The status is a flat object whose keys depend on the generation of the
// firmware ("scheme"):
//
//   classic  AC2889, AC2729, AC3829, AC3858, AC4236, 2000i, 3000i...
//            "pwr": "1", "mode": "P", "om": "2", "pm25", "iaql", "rh", "rhset",
//            "cl", "aqil", "uil", "func", "wl", "err", "fltsts0..2", "wicksts"
//   air      AC1715, AC0850 (firmware "AWS_Philips_AIR")
//            "D03-02": "ON", "D03-12": "Auto General", "D03-33" (PM2.5)...
//   modern   AC0850 Combo, AC0950, AC2220, AC3220, AC3420, AC4220, HU...
//            "D03102": 1, "D0310C": 0, "D03221" (PM2.5), "D03128"...
//
// The sensors are published when their key is present. The modes and speeds
// a model accepts are not in the status: they come from the families below,
// written for this integration from the protocol facts gathered by the Home
// Assistant community (kongo09/philips-airpurifier-coap, py-air-control,
// aioairctrl). A model missing here still gets its sensors, its power switch
// and its maintenance counters; only its mode list stays out, rather than
// sending it values it may not know.
// -----------------------------------------------------------------------------

export const SCHEMES = {
  CLASSIC: 'classic',
  AIR: 'air',
  MODERN: 'modern',
};

// Stable values of the mode list (Gladys `text/select` options): permanent.
export const MODES = [
  'auto',
  'allergen',
  'bacteria',
  'pollution',
  'gentle',
  'medium',
  'high',
  'sleep',
  'allergy_sleep',
  'turbo',
  'manual',
];

// Filters and consumables, as feature keys (permanent).
export const FILTERS = {
  PRE: 'pre-filter',
  HEPA: 'hepa-filter',
  CARBON: 'carbon-filter',
  WICK: 'wick',
};

// What each key of each scheme holds.
const KEYS = {
  [SCHEMES.CLASSIC]: {
    power: 'pwr',
    mode: 'mode',
    speed: 'om',
    pm25: 'pm25',
    allergenIndex: 'iaql',
    humidity: 'rh',
    temperature: 'temp',
    targetHumidity: 'rhset',
    humidification: 'func',
    childLock: 'cl',
    waterLevel: 'wl',
    error: 'err',
    filters: {
      [FILTERS.PRE]: 'fltsts0',
      [FILTERS.HEPA]: 'fltsts1',
      [FILTERS.CARBON]: 'fltsts2',
      [FILTERS.WICK]: 'wicksts',
    },
    // Filter type keys: "none" means the slot is empty.
    filterTypes: { [FILTERS.HEPA]: 'fltt1', [FILTERS.CARBON]: 'fltt2' },
  },
  [SCHEMES.AIR]: {
    power: 'D03-02',
    mode: 'D03-12',
    pm25: 'D03-33',
    allergenIndex: 'D03-32',
    filters: { [FILTERS.PRE]: 'D05-13', [FILTERS.HEPA]: 'D05-14' },
    filterTypes: {},
  },
  [SCHEMES.MODERN]: {
    power: 'D03102',
    mode: 'D0310C',
    pm25: 'D03221',
    allergenIndex: 'D03120',
    humidity: 'D03125',
    temperature: 'D03224',
    targetHumidity: 'D03128',
    childLock: 'D03103',
    error: 'D03240',
    filters: { [FILTERS.PRE]: 'D0520D', [FILTERS.HEPA]: 'D0540E' },
    filterTypes: {},
  },
};

const POWER = {
  [SCHEMES.CLASSIC]: { on: '1', off: '0' },
  [SCHEMES.AIR]: { on: 'ON', off: 'OFF' },
  [SCHEMES.MODERN]: { on: 1, off: 0 },
};

// A counter at its maximum: no filter in that slot.
const NO_FILTER = 65535;

// Display options: the value sent, and the label key of src/devices.js.
const DISPLAY = {
  percent: [
    { value: 0, label: 'off' },
    { value: 25, label: '25' },
    { value: 50, label: '50' },
    { value: 75, label: '75' },
    { value: 100, label: '100' },
  ],
  onOff100: [
    { value: 0, label: 'off' },
    { value: 100, label: 'on' },
  ],
  dimAuto: [
    { value: 0, label: 'off' },
    { value: 115, label: 'dim' },
    { value: 123, label: 'bright' },
    { value: 101, label: 'auto' },
  ],
  dim: [
    { value: 0, label: 'off' },
    { value: 115, label: 'dim' },
    { value: 123, label: 'bright' },
  ],
};

const range = (from, to, step) => {
  const values = [];
  for (let value = from; value <= to; value += step) {
    values.push(value);
  }
  return values;
};

// --- Families -------------------------------------------------------------------
// `modes`: Gladys value → keys to send (the power is added). `speeds`: manual
// fan speed levels, 1 to N, → keys to send. The current mode is read from the
// main mode key (`mode`, `D03-12`, `D0310C`); when several modes share its
// value, from the other keys of their pattern.

const classic = (mode, om) => (om === undefined ? { mode } : { mode, om });
const manualSpeeds = (count) =>
  Object.fromEntries(range(1, count, 1).map((level) => [level, classic('M', String(level))]));

const FAMILIES = {
  // AC2889, AC3259: auto, allergen and bacteria programs, manual speeds.
  'classic-pab': {
    scheme: SCHEMES.CLASSIC,
    modes: {
      auto: classic('P'),
      allergen: classic('A'),
      bacteria: classic('B'),
      sleep: classic('M', 's'),
      turbo: classic('M', 't'),
    },
    speeds: manualSpeeds(3),
  },
  // AC5659, AC5660: the same with "P" named pollution.
  'classic-pollution': {
    scheme: SCHEMES.CLASSIC,
    modes: {
      pollution: classic('P'),
      allergen: classic('A'),
      bacteria: classic('B'),
      sleep: classic('M', 's'),
      turbo: classic('M', 't'),
    },
    speeds: manualSpeeds(3),
  },
  // AC2729, AC3829: purifier and humidifier.
  'classic-combo': {
    scheme: SCHEMES.CLASSIC,
    modes: {
      auto: classic('P'),
      allergen: classic('A'),
      sleep: classic('S', 's'),
      turbo: classic('M', 't'),
    },
    speeds: manualSpeeds(3),
    humidifier: { targets: range(40, 70, 10) },
  },
  // Series 2000i (AC2936, AC2939, AC2958, AC2959).
  'classic-2000i': {
    scheme: SCHEMES.CLASSIC,
    modes: {
      auto: classic('AG'),
      gentle: classic('GT'),
      sleep: classic('S'),
      turbo: classic('T'),
    },
    speeds: {},
  },
  // Series 3000i without allergy sleep (AC3055, AC3059, AC3854/50, AC3858/50).
  'classic-3000i': {
    scheme: SCHEMES.CLASSIC,
    modes: {
      auto: classic('AG'),
      sleep: classic('S', 's'),
      turbo: classic('T', 't'),
    },
    speeds: manualSpeeds(2),
  },
  // Series 3000i with allergy sleep (AC3021, AC3033, AC3036, AC3039,
  // AC3854/51, AC3858/51, /83, /86), Series 4000i (AC4231, AC4236).
  'classic-3000i-as': {
    scheme: SCHEMES.CLASSIC,
    modes: {
      auto: classic('AG'),
      sleep: classic('S', 's'),
      allergy_sleep: classic('AS', 'as'),
      turbo: classic('T', 't'),
    },
    speeds: manualSpeeds(2),
  },
  // AC0850 with the "AWS_Philips_AIR" firmware.
  'air-ac0850': {
    scheme: SCHEMES.AIR,
    modes: {
      auto: { 'D03-12': 'Auto General' },
      sleep: { 'D03-12': 'Sleep' },
      turbo: { 'D03-12': 'Turbo' },
    },
    speeds: {},
    // Reported, but this model never counts it down.
    skipFilters: [FILTERS.PRE],
  },
  'air-ac1715': {
    scheme: SCHEMES.AIR,
    modes: {
      auto: { 'D03-12': 'Auto General' },
      sleep: { 'D03-12': 'Sleep' },
      turbo: { 'D03-12': 'Turbo' },
    },
    speeds: { 1: { 'D03-12': 'Gentle/Speed 1' }, 2: { 'D03-12': 'Speed 2' } },
    display: { key: 'D03-05', options: DISPLAY.onOff100 },
  },
  // AC0850 with the "AWS_Philips_AIR_Combo" firmware.
  'modern-ac0850': {
    scheme: SCHEMES.MODERN,
    modes: {
      auto: { D0310C: 0 },
      sleep: { D0310C: 17 },
      turbo: { D0310C: 18 },
    },
    speeds: {},
    skipFilters: [FILTERS.PRE],
  },
  'modern-ac0950': {
    scheme: SCHEMES.MODERN,
    modes: {
      auto: { D0310C: 0, D0310D: 1 },
      medium: { D0310C: 19, D0310D: 2 },
      sleep: { D0310C: 17, D0310D: 1 },
      turbo: { D0310C: 18, D0310D: 18 },
    },
    speeds: {},
    display: { key: 'D03105', options: DISPLAY.dimAuto },
    skipFilters: [FILTERS.PRE],
  },
  // Series 2000 / 3000 / 4000 of the new generation (AC2210-AC2221,
  // AC3210-AC3221, AC4220, AC4221).
  'modern-series': {
    scheme: SCHEMES.MODERN,
    modes: {
      auto: { D0310C: 0 },
      medium: { D0310C: 19 },
      sleep: { D0310C: 17 },
      turbo: { D0310C: 18 },
    },
    speeds: Object.fromEntries(range(1, 5, 1).map((level) => [level, { D0310C: level }])),
    display: { key: 'D03105', options: DISPLAY.dimAuto },
  },
  // AC3420, AC3421: purifier and humidifier.
  'modern-ac3420': {
    scheme: SCHEMES.MODERN,
    modes: {
      auto: { D0310C: 0, D0310D: 3 },
      medium: { D0310C: 19, D0310D: 3 },
      sleep: { D0310C: 17, D0310D: 1 },
      turbo: { D0310C: 18, D0310D: 18 },
    },
    speeds: Object.fromEntries(
      range(1, 5, 1).map((level) => [level, { D0310C: level, D0310D: level === 5 ? 18 : level }]),
    ),
    display: { key: 'D03105', options: DISPLAY.dimAuto },
    humidifier: { targets: range(40, 70, 10) },
    skipFilters: [FILTERS.PRE],
  },
  // Humidifiers HU1509, HU1510, HU4209, HU4210, HU5710.
  'modern-hu': {
    scheme: SCHEMES.MODERN,
    modes: {
      auto: { D0310C: 0 },
      sleep: { D0310C: 17 },
      medium: { D0310C: 19 },
      high: { D0310C: 65 },
    },
    speeds: {},
    display: { key: 'D03105', options: DISPLAY.dim },
    humidifier: { targets: range(30, 70, 5) },
  },
};

// Model id prefixes, the longest match wins ("AC3858/51" before "AC3858").
const MODELS = [
  ['AC2889', 'classic-pab'],
  ['AC3259', 'classic-pab'],
  ['AC5659', 'classic-pollution'],
  ['AC5660', 'classic-pollution'],
  ['AC2729', 'classic-combo'],
  ['AC3829', 'classic-combo'],
  ['AC2936', 'classic-2000i'],
  ['AC2939', 'classic-2000i'],
  ['AC2958', 'classic-2000i'],
  ['AC2959', 'classic-2000i'],
  ['AC3055', 'classic-3000i'],
  ['AC3059', 'classic-3000i'],
  ['AC3854/50', 'classic-3000i'],
  ['AC3858/50', 'classic-3000i'],
  ['AC3021', 'classic-3000i-as'],
  ['AC3033', 'classic-3000i-as'],
  ['AC3036', 'classic-3000i-as'],
  ['AC3039', 'classic-3000i-as'],
  ['AC3854/51', 'classic-3000i-as'],
  ['AC3858/51', 'classic-3000i-as'],
  ['AC3858/83', 'classic-3000i-as'],
  ['AC3858/86', 'classic-3000i-as'],
  ['AC4231', 'classic-3000i-as'],
  ['AC4236', 'classic-3000i-as'],
  ['AC0850', 'air-ac0850'],
  ['AC1715', 'air-ac1715'],
  ['AC0850', 'modern-ac0850'],
  ['AC0950', 'modern-ac0950'],
  ['AC0951', 'modern-ac0950'],
  ['AC2210', 'modern-series'],
  ['AC2220', 'modern-series'],
  ['AC2221', 'modern-series'],
  ['AC3210', 'modern-series'],
  ['AC3220', 'modern-series'],
  ['AC3221', 'modern-series'],
  ['AC4220', 'modern-series'],
  ['AC4221', 'modern-series'],
  ['AC3420', 'modern-ac3420'],
  ['AC3421', 'modern-ac3420'],
  ['HU1509', 'modern-hu'],
  ['HU1510', 'modern-hu'],
  ['HU4209', 'modern-hu'],
  ['HU4210', 'modern-hu'],
  ['HU5710', 'modern-hu'],
];

/** Every model id prefix the families cover, by scheme (for the docs and tests). */
export function supportedModels() {
  return MODELS.map(([prefix, family]) => ({ prefix, scheme: FAMILIES[family].scheme }));
}

// --- Reading the status ------------------------------------------------------------

/** The key generation of a status, or null when it is not a Philips status. */
export function schemeOf(status) {
  if (!status || typeof status !== 'object') {
    return null;
  }
  if ('D03102' in status) {
    return SCHEMES.MODERN;
  }
  if ('D03-02' in status) {
    return SCHEMES.AIR;
  }
  if ('pwr' in status) {
    return SCHEMES.CLASSIC;
  }
  return null;
}

const text = (value) => (typeof value === 'string' ? value.trim() : '');

/** "AC2889/10": the model id the device reports. */
export function modelOf(status) {
  return (
    text(status.modelid) ||
    text(status['D01-05']) ||
    text(status.D01S05) ||
    text(status.type) ||
    ''
  ).toUpperCase();
}

/** The name given in the Philips app. */
export function nameOf(status) {
  return text(status.name) || text(status['D01-03']) || text(status.D01S03);
}

/** The unique id of the device (32 hex digits), its identity in Gladys. */
export function deviceIdOf(status) {
  const id = text(status.DeviceId).toLowerCase();
  return /^[0-9a-f]{8,64}$/.test(id) ? id : null;
}

export function firmwareOf(status) {
  return text(status.swversion) || text(status['D01-21']) || text(status.D01S12) || null;
}

/** The family of a model in its scheme, or null. */
export function familyOf(scheme, model) {
  let best = null;
  for (const [prefix, family] of MODELS) {
    if (
      FAMILIES[family].scheme === scheme &&
      model.startsWith(prefix) &&
      (!best || prefix.length > best.prefix.length)
    ) {
      best = { prefix, family };
    }
  }
  return best?.family ?? null;
}

const isNumber = (value) => typeof value === 'number' && Number.isFinite(value);

/** A number from a number or a numeric text, else null. */
function numberOf(value) {
  if (isNumber(value)) {
    return value;
  }
  if (typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value.trim())) {
    return Number(value);
  }
  return null;
}

/** true/false from a boolean, "true"/"false", 1/0. */
function booleanOf(value) {
  if (typeof value === 'boolean') {
    return value;
  }
  if (value === 'true' || value === 1 || value === '1') {
    return true;
  }
  if (value === 'false' || value === 0 || value === '0') {
    return false;
  }
  return null;
}

/**
 * What a device can do, from one status (or the keys of a stored one).
 * @param {object} status reported state (only its keys and a few values matter)
 * @returns {object|null} null when the status is not a Philips one
 */
export function capabilitiesOf(status) {
  const scheme = schemeOf(status);
  if (!scheme) {
    return null;
  }
  const keys = KEYS[scheme];
  const model = modelOf(status);
  const familyKey = familyOf(scheme, model);
  const family = familyKey ? FAMILIES[familyKey] : null;
  const has = (key) => key !== undefined && key in status;

  const filters = Object.entries(keys.filters)
    .filter(([filter, key]) => {
      if (!has(key) || family?.skipFilters?.includes(filter)) {
        return false;
      }
      const typeKey = keys.filterTypes[filter];
      if (typeKey && text(status[typeKey]).toLowerCase() === 'none') {
        return false;
      }
      return numberOf(status[key]) !== NO_FILTER;
    })
    .map(([filter]) => filter);

  let display = null;
  if (family?.display && has(family.display.key)) {
    display = family.display;
  } else if (scheme === SCHEMES.CLASSIC && has('aqil')) {
    display = { key: 'aqil', options: DISPLAY.percent };
  } else if (scheme === SCHEMES.CLASSIC && has('uil')) {
    display = {
      key: 'uil',
      options: [
        { value: '0', label: 'off' },
        { value: '1', label: 'on' },
      ],
    };
  }

  const humidifier = family?.humidifier ?? null;
  return {
    scheme,
    model,
    family: familyKey,
    modes: family ? Object.keys(family.modes) : [],
    speeds: family ? Object.keys(family.speeds).length : 0,
    pm25: has(keys.pm25),
    allergenIndex: has(keys.allergenIndex),
    humidity: has(keys.humidity),
    temperature: has(keys.temperature),
    targetHumidity: humidifier && has(keys.targetHumidity) ? humidifier.targets : null,
    humidification: Boolean(humidifier) && has(keys.humidification),
    waterTank: Boolean(humidifier) && (has(keys.waterLevel) || has(keys.error)),
    childLock: has(keys.childLock),
    display,
    filters,
  };
}

/** True when every key of `pattern` has its value in `status` ("1" equals 1). */
function matches(status, pattern) {
  return Object.entries(pattern).every(([key, value]) => String(status[key]) === String(value));
}

/** The current mode (a MODES value), or null when it cannot be told. */
export function modeOf(status, caps) {
  const family = caps.family ? FAMILIES[caps.family] : null;
  if (!family) {
    return null;
  }
  const modeKey = KEYS[caps.scheme].mode;
  const current = status[modeKey];
  const candidates = Object.entries(family.modes).filter(
    ([, pattern]) => String(pattern[modeKey]) === String(current),
  );
  const exact = candidates.find(([, pattern]) => matches(status, pattern));
  if (exact) {
    return exact[0];
  }
  // Classic: the manual letter ("M") is shared with modes told apart by the
  // speed ("M" + "t" is turbo), a numeric speed there is manual. Other
  // schemes: the speed level is the value of the mode key itself.
  const manualLetter = Object.values(family.speeds)[0]?.[modeKey];
  if (
    speedOf(status, caps) !== null &&
    (caps.scheme !== SCHEMES.CLASSIC || String(manualLetter) === String(current))
  ) {
    return 'manual';
  }
  return candidates.length === 1 ? candidates[0][0] : null;
}

/** The manual fan speed level (1 to N), or null. */
export function speedOf(status, caps) {
  const family = caps.family ? FAMILIES[caps.family] : null;
  if (!family) {
    return null;
  }
  if (caps.scheme === SCHEMES.CLASSIC) {
    // `om` is the speed the fan turns at, in auto programs too.
    const level = numberOf(status.om);
    return level !== null && level >= 1 && level <= caps.speeds ? level : null;
  }
  const found = Object.entries(family.speeds).find(([, pattern]) => {
    const modeKey = KEYS[caps.scheme].mode;
    return String(status[modeKey]) === String(pattern[modeKey]);
  });
  return found ? Number(found[0]) : null;
}

/**
 * The readings of a status, normalized: numbers, booleans and option values,
 * only for what the device reported.
 */
export function readingsOf(status, caps) {
  const keys = KEYS[caps.scheme];
  const readings = { filters: {} };
  const power = status[keys.power];
  if (power !== undefined) {
    readings.power = String(power) === String(POWER[caps.scheme].on);
  }
  const mode = modeOf(status, caps);
  if (mode !== null) {
    readings.mode = mode;
  }
  const speed = speedOf(status, caps);
  if (speed !== null) {
    readings.speed = speed;
  }
  const number = (key) => (key === undefined ? null : numberOf(status[key]));
  if (caps.pm25 && number(keys.pm25) !== null) {
    readings.pm25 = number(keys.pm25);
  }
  if (caps.allergenIndex && number(keys.allergenIndex) !== null) {
    readings.allergenIndex = number(keys.allergenIndex);
  }
  if (caps.humidity && number(keys.humidity) !== null) {
    readings.humidity = number(keys.humidity);
  }
  if (caps.temperature && number(keys.temperature) !== null) {
    // The new generation reports tenths of a degree.
    const raw = number(keys.temperature);
    readings.temperature = caps.scheme === SCHEMES.MODERN ? raw / 10 : raw;
  }
  if (caps.targetHumidity && number(keys.targetHumidity) !== null) {
    readings.targetHumidity = number(keys.targetHumidity);
  }
  if (caps.humidification && typeof status[keys.humidification] === 'string') {
    readings.humidification = status[keys.humidification] === 'PH';
  }
  if (caps.waterTank) {
    const level = number(keys.waterLevel);
    const error = number(keys.error) ?? 0;
    // Bit 8 of the error code is "no water" (py-air-control: 49408 "no
    // water", 32768 "water tank open").
    readings.waterEmpty = level === 0 || error === 32768 || (error & 0x100) !== 0;
  }
  if (caps.childLock) {
    const locked = booleanOf(status[keys.childLock]);
    if (locked !== null) {
      readings.childLock = locked;
    }
  }
  if (caps.display) {
    const value = status[caps.display.key];
    const option = caps.display.options.find(
      (candidate) => String(candidate.value) === String(value),
    );
    if (option) {
      readings.display = String(option.value);
    }
  }
  for (const filter of caps.filters) {
    const hours = number(keys.filters[filter]);
    if (hours !== null && hours >= 0) {
      readings.filters[filter] = hours;
    }
  }
  return readings;
}

// --- Commands -----------------------------------------------------------------------

export class UnsupportedError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UnsupportedError';
  }
}

const powerOn = (caps) => ({ [KEYS[caps.scheme].power]: POWER[caps.scheme].on });

/** Keys to send to switch the device on or off. */
export function powerCommand(caps, on) {
  return { [KEYS[caps.scheme].power]: POWER[caps.scheme][on ? 'on' : 'off'] };
}

/** Keys to send for a mode (it also switches the device on). */
export function modeCommand(caps, mode) {
  const family = caps.family ? FAMILIES[caps.family] : null;
  const pattern = family?.modes[mode];
  if (!pattern) {
    throw new UnsupportedError(`Mode "${mode}" is not available on ${caps.model || 'this model'}`);
  }
  return { ...powerOn(caps), ...pattern };
}

/** Keys to send for a manual fan speed (manual mode, device on). */
export function speedCommand(caps, level) {
  const family = caps.family ? FAMILIES[caps.family] : null;
  const pattern = family?.speeds[Math.round(Number(level))];
  if (!pattern) {
    throw new UnsupportedError(
      `Fan speed ${level} is not available on ${caps.model || 'this model'}`,
    );
  }
  return { ...powerOn(caps), ...pattern };
}

export function targetHumidityCommand(caps, value) {
  const target = Number(value);
  if (!caps.targetHumidity?.includes(target)) {
    throw new UnsupportedError(`Target humidity ${value} % is not available`);
  }
  return { [KEYS[caps.scheme].targetHumidity]: target };
}

export function humidificationCommand(caps, on) {
  if (!caps.humidification) {
    throw new UnsupportedError('This model has no humidification switch');
  }
  return { [KEYS[caps.scheme].humidification]: on ? 'PH' : 'P' };
}

export function childLockCommand(caps, locked) {
  if (!caps.childLock) {
    throw new UnsupportedError('This model has no child lock');
  }
  return {
    [KEYS[caps.scheme].childLock]: caps.scheme === SCHEMES.CLASSIC ? locked : locked ? 1 : 0,
  };
}

export function displayCommand(caps, value) {
  const option = caps.display?.options.find(
    (candidate) => String(candidate.value) === String(value),
  );
  if (!option) {
    throw new UnsupportedError(`Display setting "${value}" is not available`);
  }
  return { [caps.display.key]: option.value };
}

/** The status once `values` are applied, without waiting for the device. */
export function applyValues(status, values) {
  return { ...status, ...values };
}

/** The keys of a status that tell its capabilities (stored under /data). */
export function capabilityKeys(status) {
  const scheme = schemeOf(status);
  if (!scheme) {
    return null;
  }
  const keys = KEYS[scheme];
  const kept = new Set([
    keys.power,
    keys.pm25,
    keys.allergenIndex,
    keys.humidity,
    keys.temperature,
    keys.targetHumidity,
    keys.humidification,
    keys.childLock,
    keys.waterLevel,
    keys.error,
    ...Object.values(keys.filters),
    'aqil',
    'uil',
    'D03-05',
    'D03105',
  ]);
  const skeleton = { modelid: modelOf(status) };
  for (const key of Object.keys(status)) {
    if (kept.has(key)) {
      skeleton[key] = status[key];
    }
  }
  // Filter types say whether a slot is empty.
  for (const typeKey of Object.values(keys.filterTypes)) {
    if (typeKey in status) {
      skeleton[typeKey] = status[typeKey];
    }
  }
  return skeleton;
}
