// -----------------------------------------------------------------------------
// From a Philips purifier to a Gladys device, and back: discovery payload,
// state values, and the Philips keys of each command.
//
// One Gladys device per purifier, keyed on the DeviceId it reports (its
// address may change). Only what the model has is published: a humidifier
// gets its target humidity and its water tank, a purifier with a carbon
// filter its counter, a model missing from src/philips/models.js no mode list.
//
// Feature keys are part of the external ids: permanent.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as CATEGORIES,
  DEVICE_FEATURE_TYPES as TYPES,
  DEVICE_FEATURE_UNITS as UNITS,
} from '@gladysassistant/integration-sdk';
import {
  FILTERS,
  UnsupportedError,
  childLockCommand,
  displayCommand,
  humidificationCommand,
  modeCommand,
  powerCommand,
  speedCommand,
  targetHumidityCommand,
} from './philips/models.js';

export const DEVICE_TYPE = 'purifier';

export const FEATURE_KEYS = {
  POWER: 'power',
  MODE: 'mode',
  SPEED: 'fan-speed',
  PM25: 'pm25',
  ALLERGEN_INDEX: 'allergen-index',
  HUMIDITY: 'humidity',
  TEMPERATURE: 'temperature',
  TARGET_HUMIDITY: 'target-humidity',
  HUMIDIFICATION: 'humidification',
  WATER_TANK: 'water-tank',
  CHILD_LOCK: 'child-lock',
  DISPLAY: 'display',
  PRE_FILTER: FILTERS.PRE,
  HEPA_FILTER: FILTERS.HEPA,
  CARBON_FILTER: FILTERS.CARBON,
  WICK: FILTERS.WICK,
};

// Gladys level-sensor liquid states.
export const WATER = { LOW: 0, NORMAL: 1 };

// Feature names are frozen when the user creates the device: written in the
// language chosen in the configuration at that moment.
export const NAMES = {
  en: {
    [FEATURE_KEYS.POWER]: 'Power',
    [FEATURE_KEYS.MODE]: 'Mode',
    [FEATURE_KEYS.SPEED]: 'Fan speed',
    [FEATURE_KEYS.PM25]: 'PM2.5',
    [FEATURE_KEYS.ALLERGEN_INDEX]: 'Allergen index',
    [FEATURE_KEYS.HUMIDITY]: 'Humidity',
    [FEATURE_KEYS.TEMPERATURE]: 'Temperature',
    [FEATURE_KEYS.TARGET_HUMIDITY]: 'Target humidity',
    [FEATURE_KEYS.HUMIDIFICATION]: 'Humidification',
    [FEATURE_KEYS.WATER_TANK]: 'Water tank',
    [FEATURE_KEYS.CHILD_LOCK]: 'Child lock',
    [FEATURE_KEYS.DISPLAY]: 'Display light',
    [FEATURE_KEYS.PRE_FILTER]: 'Pre-filter (hours left)',
    [FEATURE_KEYS.HEPA_FILTER]: 'HEPA filter (hours left)',
    [FEATURE_KEYS.CARBON_FILTER]: 'Carbon filter (hours left)',
    [FEATURE_KEYS.WICK]: 'Wick (hours left)',
  },
  fr: {
    [FEATURE_KEYS.POWER]: 'Marche / arrêt',
    [FEATURE_KEYS.MODE]: 'Mode',
    [FEATURE_KEYS.SPEED]: 'Vitesse du ventilateur',
    [FEATURE_KEYS.PM25]: 'PM2.5',
    [FEATURE_KEYS.ALLERGEN_INDEX]: "Indice d'allergènes",
    [FEATURE_KEYS.HUMIDITY]: 'Humidité',
    [FEATURE_KEYS.TEMPERATURE]: 'Température',
    [FEATURE_KEYS.TARGET_HUMIDITY]: 'Humidité cible',
    [FEATURE_KEYS.HUMIDIFICATION]: 'Humidification',
    [FEATURE_KEYS.WATER_TANK]: "Réservoir d'eau",
    [FEATURE_KEYS.CHILD_LOCK]: 'Sécurité enfant',
    [FEATURE_KEYS.DISPLAY]: "Éclairage de l'écran",
    [FEATURE_KEYS.PRE_FILTER]: 'Pré-filtre (heures restantes)',
    [FEATURE_KEYS.HEPA_FILTER]: 'Filtre HEPA (heures restantes)',
    [FEATURE_KEYS.CARBON_FILTER]: 'Filtre à charbon (heures restantes)',
    [FEATURE_KEYS.WICK]: 'Mèche (heures restantes)',
  },
  de: {
    [FEATURE_KEYS.POWER]: 'Ein/Aus',
    [FEATURE_KEYS.MODE]: 'Modus',
    [FEATURE_KEYS.SPEED]: 'Lüfterstufe',
    [FEATURE_KEYS.PM25]: 'PM2.5',
    [FEATURE_KEYS.ALLERGEN_INDEX]: 'Allergenindex',
    [FEATURE_KEYS.HUMIDITY]: 'Luftfeuchtigkeit',
    [FEATURE_KEYS.TEMPERATURE]: 'Temperatur',
    [FEATURE_KEYS.TARGET_HUMIDITY]: 'Zielluftfeuchtigkeit',
    [FEATURE_KEYS.HUMIDIFICATION]: 'Befeuchtung',
    [FEATURE_KEYS.WATER_TANK]: 'Wassertank',
    [FEATURE_KEYS.CHILD_LOCK]: 'Kindersicherung',
    [FEATURE_KEYS.DISPLAY]: 'Displaybeleuchtung',
    [FEATURE_KEYS.PRE_FILTER]: 'Vorfilter (Reststunden)',
    [FEATURE_KEYS.HEPA_FILTER]: 'HEPA-Filter (Reststunden)',
    [FEATURE_KEYS.CARBON_FILTER]: 'Aktivkohlefilter (Reststunden)',
    [FEATURE_KEYS.WICK]: 'Docht (Reststunden)',
  },
  es: {
    [FEATURE_KEYS.POWER]: 'Encendido',
    [FEATURE_KEYS.MODE]: 'Modo',
    [FEATURE_KEYS.SPEED]: 'Velocidad del ventilador',
    [FEATURE_KEYS.PM25]: 'PM2.5',
    [FEATURE_KEYS.ALLERGEN_INDEX]: 'Índice de alérgenos',
    [FEATURE_KEYS.HUMIDITY]: 'Humedad',
    [FEATURE_KEYS.TEMPERATURE]: 'Temperatura',
    [FEATURE_KEYS.TARGET_HUMIDITY]: 'Humedad objetivo',
    [FEATURE_KEYS.HUMIDIFICATION]: 'Humidificación',
    [FEATURE_KEYS.WATER_TANK]: 'Depósito de agua',
    [FEATURE_KEYS.CHILD_LOCK]: 'Bloqueo infantil',
    [FEATURE_KEYS.DISPLAY]: 'Iluminación de la pantalla',
    [FEATURE_KEYS.PRE_FILTER]: 'Prefiltro (horas restantes)',
    [FEATURE_KEYS.HEPA_FILTER]: 'Filtro HEPA (horas restantes)',
    [FEATURE_KEYS.CARBON_FILTER]: 'Filtro de carbón (horas restantes)',
    [FEATURE_KEYS.WICK]: 'Mecha (horas restantes)',
  },
};

// Labels of the mode list and of the display settings.
export const OPTION_LABELS = {
  en: {
    auto: 'Auto',
    allergen: 'Allergen',
    bacteria: 'Bacteria and virus',
    pollution: 'Pollution',
    gentle: 'Gentle',
    medium: 'Medium',
    high: 'High',
    sleep: 'Sleep',
    allergy_sleep: 'Allergy sleep',
    turbo: 'Turbo',
    manual: 'Manual',
    off: 'Off',
    on: 'On',
    dim: 'Dim',
    bright: 'Bright',
  },
  fr: {
    auto: 'Auto',
    allergen: 'Allergènes',
    bacteria: 'Bactéries et virus',
    pollution: 'Pollution',
    gentle: 'Doux',
    medium: 'Moyen',
    high: 'Fort',
    sleep: 'Sommeil',
    allergy_sleep: 'Sommeil allergies',
    turbo: 'Turbo',
    manual: 'Manuel',
    off: 'Éteint',
    on: 'Allumé',
    dim: 'Atténué',
    bright: 'Lumineux',
  },
  de: {
    auto: 'Automatik',
    allergen: 'Allergene',
    bacteria: 'Bakterien und Viren',
    pollution: 'Verschmutzung',
    gentle: 'Sanft',
    medium: 'Mittel',
    high: 'Hoch',
    sleep: 'Schlafmodus',
    allergy_sleep: 'Allergie-Schlafmodus',
    turbo: 'Turbo',
    manual: 'Manuell',
    off: 'Aus',
    on: 'An',
    dim: 'Gedimmt',
    bright: 'Hell',
  },
  es: {
    auto: 'Automático',
    allergen: 'Alérgenos',
    bacteria: 'Bacterias y virus',
    pollution: 'Contaminación',
    gentle: 'Suave',
    medium: 'Medio',
    high: 'Alto',
    sleep: 'Sueño',
    allergy_sleep: 'Sueño alergias',
    turbo: 'Turbo',
    manual: 'Manual',
    off: 'Apagado',
    on: 'Encendido',
    dim: 'Atenuado',
    bright: 'Brillante',
  },
};

export const namesFor = (language) => NAMES[language] ?? NAMES.en;
const labelsFor = (language) => OPTION_LABELS[language] ?? OPTION_LABELS.en;

/** A label of OPTION_LABELS, or "25 %" for a percentage. */
export function optionLabel(key, language) {
  return labelsFor(language)[key] ?? `${key} %`;
}

/** External ids of the Gladys device of a purifier. */
export const deviceIds = (gladys, deviceId) => gladys.externalIds(DEVICE_TYPE, deviceId);

/** "Bedroom (AC2729/10)", or "Philips AC2729/10" without a name in the app. */
export function deviceName(record) {
  const model = record.caps?.model || 'Philips';
  return record.name ? `${record.name} (${model})` : `Philips ${model}`;
}

/** The mode list of a device: its modes, then "manual" when it has speeds. */
export function modeValues(caps) {
  return caps.speeds > 0 ? [...caps.modes, 'manual'] : [...caps.modes];
}

const withOrder = (options) => options.map((option, index) => ({ ...option, sort_order: index }));

const FILTER_KEYS = [
  FEATURE_KEYS.PRE_FILTER,
  FEATURE_KEYS.HEPA_FILTER,
  FEATURE_KEYS.CARBON_FILTER,
  FEATURE_KEYS.WICK,
];

/**
 * Feature specs of a device, in publication order.
 * @param {object} caps capabilitiesOf() of the device
 * @param {string} language
 */
export function featureSpecs(caps, language) {
  const names = namesFor(language);
  const specs = [
    {
      key: FEATURE_KEYS.POWER,
      category: CATEGORIES.SWITCH,
      type: TYPES.SWITCH.BINARY,
      min: 0,
      max: 1,
      history: true,
    },
  ];
  const modes = modeValues(caps);
  if (modes.length > 0) {
    specs.push({
      key: FEATURE_KEYS.MODE,
      category: CATEGORIES.TEXT,
      type: TYPES.TEXT.SELECT,
      min: 0,
      max: 0,
      history: false,
      supported_options: withOrder(
        modes.map((mode) => ({ value: mode, label: optionLabel(mode, language) })),
      ),
    });
  }
  if (caps.speeds > 0) {
    specs.push({
      key: FEATURE_KEYS.SPEED,
      category: CATEGORIES.FAN,
      type: TYPES.FAN.SPEED,
      min: 1,
      max: caps.speeds,
      history: true,
    });
  }
  if (caps.pm25) {
    specs.push({
      key: FEATURE_KEYS.PM25,
      category: CATEGORIES.PM25_SENSOR,
      type: TYPES.SENSOR.DECIMAL,
      unit: UNITS.MICROGRAM_PER_CUBIC_METER,
      min: 0,
      max: 999,
      read_only: true,
      history: true,
    });
  }
  if (caps.allergenIndex) {
    // Philips' indoor allergen index runs from 1 (good) to 12 (very poor): a
    // plain number, the air quality category would color it on the 0-500
    // AQI scale (always green).
    specs.push({
      key: FEATURE_KEYS.ALLERGEN_INDEX,
      category: CATEGORIES.COUNTER_SENSOR,
      type: TYPES.SENSOR.INTEGER,
      min: 0,
      max: 12,
      read_only: true,
      history: true,
    });
  }
  if (caps.humidity) {
    specs.push({
      key: FEATURE_KEYS.HUMIDITY,
      category: CATEGORIES.HUMIDITY_SENSOR,
      type: TYPES.SENSOR.DECIMAL,
      unit: UNITS.PERCENT,
      min: 0,
      max: 100,
      read_only: true,
      history: true,
    });
  }
  if (caps.temperature) {
    specs.push({
      key: FEATURE_KEYS.TEMPERATURE,
      category: CATEGORIES.TEMPERATURE_SENSOR,
      type: TYPES.SENSOR.DECIMAL,
      unit: UNITS.CELSIUS,
      min: -10,
      max: 50,
      read_only: true,
      history: true,
    });
  }
  if (caps.targetHumidity) {
    // A list: the device only takes these values.
    specs.push({
      key: FEATURE_KEYS.TARGET_HUMIDITY,
      category: CATEGORIES.TEXT,
      type: TYPES.TEXT.SELECT,
      min: 0,
      max: 0,
      history: false,
      supported_options: withOrder(
        caps.targetHumidity.map((value) => ({ value: String(value), label: `${value} %` })),
      ),
    });
  }
  if (caps.humidification) {
    specs.push({
      key: FEATURE_KEYS.HUMIDIFICATION,
      category: CATEGORIES.SWITCH,
      type: TYPES.SWITCH.BINARY,
      min: 0,
      max: 1,
      history: true,
    });
  }
  if (caps.waterTank) {
    specs.push({
      key: FEATURE_KEYS.WATER_TANK,
      category: CATEGORIES.LEVEL_SENSOR,
      type: TYPES.LEVEL_SENSOR.LIQUID_STATE,
      min: WATER.LOW,
      max: 2,
      read_only: true,
      history: true,
    });
  }
  if (caps.childLock) {
    specs.push({
      key: FEATURE_KEYS.CHILD_LOCK,
      category: CATEGORIES.CHILD_LOCK,
      type: TYPES.CHILD_LOCK.BINARY,
      min: 0,
      max: 1,
      history: true,
    });
  }
  if (caps.display) {
    specs.push({
      key: FEATURE_KEYS.DISPLAY,
      category: CATEGORIES.TEXT,
      type: TYPES.TEXT.SELECT,
      min: 0,
      max: 0,
      history: false,
      supported_options: withOrder(
        caps.display.options.map((option) => ({
          value: String(option.value),
          label: optionLabel(option.label, language),
        })),
      ),
    });
  }
  for (const key of FILTER_KEYS) {
    if (caps.filters.includes(key)) {
      specs.push({
        key,
        category: CATEGORIES.DURATION,
        type: TYPES.DURATION.INTEGER,
        unit: UNITS.HOURS,
        min: 0,
        max: 20000,
        read_only: true,
        history: true,
      });
    }
  }
  return specs.map((spec) => ({ ...spec, name: names[spec.key] }));
}

/** Discovery payload of one purifier. */
export function buildDevice(gladys, record, language) {
  const ids = deviceIds(gladys, record.deviceId);
  const params = [{ name: 'IP_ADDRESS', value: record.host }];
  if (record.caps.model) {
    params.push({ name: 'MODEL', value: record.caps.model });
  }
  if (record.firmware) {
    params.push({ name: 'FIRMWARE', value: record.firmware });
  }
  return {
    name: deviceName(record),
    external_id: ids.device,
    model: record.caps.model || 'Philips',
    // The container reads every purifier itself (and takes its pushes): the
    // Gladys scheduler does not poll external devices reliably (Gladys#3198).
    should_poll: false,
    params,
    features: featureSpecs(record.caps, language).map((spec) => {
      const feature = {
        name: spec.name,
        external_id: ids.feature(spec.key),
        category: spec.category,
        type: spec.type,
        min: spec.min,
        max: spec.max,
        read_only: spec.read_only === true,
        has_feedback: true,
        keep_history: spec.history,
      };
      if (spec.unit) {
        feature.unit = spec.unit;
      }
      if (spec.supported_options) {
        feature.supported_options = spec.supported_options;
      }
      return feature;
    }),
  };
}

/**
 * Feature values of a device, by feature key: numbers, or `{ text }` for the
 * lists. Only what the last status told.
 * @param {object} readings readingsOf() of the device
 */
export function deviceValues(caps, readings) {
  const values = {};
  const bit = (value) => (value ? 1 : 0);
  if (typeof readings.power === 'boolean') {
    values[FEATURE_KEYS.POWER] = bit(readings.power);
  }
  if (readings.mode && modeValues(caps).includes(readings.mode)) {
    values[FEATURE_KEYS.MODE] = { text: readings.mode };
  }
  if (caps.speeds > 0 && typeof readings.speed === 'number') {
    values[FEATURE_KEYS.SPEED] = readings.speed;
  }
  for (const [key, reading] of [
    [FEATURE_KEYS.PM25, readings.pm25],
    [FEATURE_KEYS.ALLERGEN_INDEX, readings.allergenIndex],
    [FEATURE_KEYS.HUMIDITY, readings.humidity],
    [FEATURE_KEYS.TEMPERATURE, readings.temperature],
  ]) {
    if (typeof reading === 'number') {
      values[key] = reading;
    }
  }
  if (caps.targetHumidity && typeof readings.targetHumidity === 'number') {
    values[FEATURE_KEYS.TARGET_HUMIDITY] = { text: String(readings.targetHumidity) };
  }
  if (typeof readings.humidification === 'boolean') {
    values[FEATURE_KEYS.HUMIDIFICATION] = bit(readings.humidification);
  }
  if (typeof readings.waterEmpty === 'boolean') {
    values[FEATURE_KEYS.WATER_TANK] = readings.waterEmpty ? WATER.LOW : WATER.NORMAL;
  }
  if (typeof readings.childLock === 'boolean') {
    values[FEATURE_KEYS.CHILD_LOCK] = bit(readings.childLock);
  }
  if (typeof readings.display === 'string') {
    values[FEATURE_KEYS.DISPLAY] = { text: readings.display };
  }
  for (const [filter, hours] of Object.entries(readings.filters ?? {})) {
    values[filter] = Math.round(hours);
  }
  return values;
}

/**
 * The Philips keys of a Gladys command.
 * @param {object} record the device record (caps, readings)
 * @param {string} key feature key
 * @param {number|string} value
 * @throws {UnsupportedError} for a value the device does not take
 */
export function commandFor(record, key, value) {
  const { caps } = record;
  const on = Number(value) > 0;
  switch (key) {
    case FEATURE_KEYS.POWER:
      return powerCommand(caps, on);
    case FEATURE_KEYS.MODE:
      if (value === 'manual') {
        // The manual mode is a fan speed: the current one, or the lowest.
        return speedCommand(caps, record.readings?.speed ?? 1);
      }
      return modeCommand(caps, String(value));
    case FEATURE_KEYS.SPEED:
      return speedCommand(caps, value);
    case FEATURE_KEYS.TARGET_HUMIDITY:
      return targetHumidityCommand(caps, value);
    case FEATURE_KEYS.HUMIDIFICATION:
      return humidificationCommand(caps, on);
    case FEATURE_KEYS.CHILD_LOCK:
      return childLockCommand(caps, on);
    case FEATURE_KEYS.DISPLAY:
      return displayCommand(caps, value);
    default:
      throw new UnsupportedError(`Feature "${key}" cannot be set`);
  }
}
