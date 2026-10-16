// -----------------------------------------------------------------------------
// Dashboard widget (manifest `widgets`, Gladys 5.1+): `purifier`.
//
// The Gladys device box already has the switch, the mode list, the speed and
// the sensors. What the widget adds: the allergen index read on the Philips
// scale (good, fair, poor, very poor: the generic air quality colors would
// keep it green), the filter closest to its end or what the purifier asks
// for, the boost with its end time, and one-tap buttons for the usual modes.
//
// Budget (8 components, 2 texts, 1 status, 4 buttons): a caption, up to two
// live tiles, one status list, up to four buttons. The running mode is marked
// by its icon (`check-circle`), never by the button style: `primary` is
// invisible in dark mode.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { FEATURE_KEYS, deviceIds, namesFor, optionLabel } from './devices.js';
import { BOOST_ACTION, WIDGET_KEY } from './hub.js';
import { BOOST_TEXT, MAINTENANCE_TEXT, render } from './texts.js';

const ACTIVE_ICON = 'check-circle';
const MODE_ACTION_PREFIX = 'mode_';
const POWER_ACTION = 'power';
// The modes offered as buttons, in this order, when the model has them.
const BUTTON_MODES = ['auto', 'pollution', 'sleep'];
const MAX_MODE_BUTTONS = 2;

export const BOOST_DURATIONS = [15, 30, 60];
export const DEFAULT_BOOST_MINUTES = 30;

export const TEXT = {
  pick: {
    en: 'Choose a Philips purifier in the settings of this widget.',
    fr: 'Choisissez un purificateur Philips dans les réglages de ce widget.',
    de: 'Wähle in den Einstellungen dieses Widgets einen Philips-Luftreiniger aus.',
    es: 'Elija un purificador Philips en la configuración de este widget.',
  },
  unknown: {
    en: 'This purifier is not known yet: check its IP address in the integration.',
    fr: "Ce purificateur est inconnu : vérifiez son adresse IP dans l'intégration.",
    de: 'Dieser Luftreiniger ist noch unbekannt: Prüfe seine IP-Adresse in der Integration.',
    es: 'Este purificador aún no es conocido: compruebe su dirección IP en la integración.',
  },
  unreachable: {
    en: 'not answering',
    fr: 'ne répond pas',
    de: 'antwortet nicht',
    es: 'no responde',
  },
  airQuality: { en: 'Allergens', fr: 'Allergènes', de: 'Allergene', es: 'Alérgenos' },
  good: { en: 'Good', fr: 'Bon', de: 'Gut', es: 'Bueno' },
  fair: { en: 'Fair', fr: 'Moyen', de: 'Mäßig', es: 'Regular' },
  poor: { en: 'Poor', fr: 'Mauvais', de: 'Schlecht', es: 'Malo' },
  veryPoor: { en: 'Very poor', fr: 'Très mauvais', de: 'Sehr schlecht', es: 'Muy malo' },
  off: { en: 'Off', fr: 'Éteint', de: 'Aus', es: 'Apagado' },
  boost: { en: 'Boost', fr: 'Boost', de: 'Boost', es: 'Impulso' },
  until: { en: 'until', fr: "jusqu'à", de: 'bis', es: 'hasta' },
  maintenance: { en: 'Maintenance', fr: 'Entretien', de: 'Wartung', es: 'Mantenimiento' },
  turnOn: { en: 'Turn on', fr: 'Allumer', de: 'Einschalten', es: 'Encender' },
  turnOff: { en: 'Turn off', fr: 'Éteindre', de: 'Ausschalten', es: 'Apagar' },
  switchedOn: { en: 'Turned on', fr: 'Allumé', de: 'Eingeschaltet', es: 'Encendido' },
  switchedOff: { en: 'Turned off', fr: 'Éteint', de: 'Ausgeschaltet', es: 'Apagado' },
  modeSet: { en: 'Mode: ', fr: 'Mode : ', de: 'Modus: ', es: 'Modo: ' },
};

const t = (text, language) => text[language] ?? text.en;

/** The Philips allergen index bands: 1-3 good, 4-6 fair, 7-9 poor, 10-12 very poor. */
export function allergenBand(index) {
  if (index <= 3) {
    return { text: TEXT.good, color: WIDGET_COLORS.SUCCESS };
  }
  if (index <= 6) {
    return { text: TEXT.fair, color: WIDGET_COLORS.WARNING };
  }
  if (index <= 9) {
    return { text: TEXT.poor, color: WIDGET_COLORS.DANGER };
  }
  return { text: TEXT.veryPoor, color: WIDGET_COLORS.DANGER };
}

/** Boost duration of the widget settings, in minutes. */
export function boostMinutes(settings) {
  const minutes = Number(settings?.boost_minutes);
  return BOOST_DURATIONS.includes(minutes) ? minutes : DEFAULT_BOOST_MINUTES;
}

function message(text, language) {
  return {
    ttl_seconds: 300,
    components: [{ type: 'text', variant: 'body', text: t(text, language) }],
  };
}

const timeOf = (until, language) =>
  new Date(until).toLocaleTimeString(language, { hour: '2-digit', minute: '2-digit' });

/** The maintenance row: what the purifier asks for, else the closest filter. */
function maintenanceItem(hub, record, language) {
  const names = namesFor(language);
  const asked = [...hub.maintenanceOf(record)];
  if (asked.length > 0) {
    const [item] = asked[0];
    return {
      label: t(TEXT.maintenance, language),
      icon: item === 'water-tank' ? 'droplet' : 'tool',
      value: t(MAINTENANCE_TEXT, language)[item],
      color: item === 'water-tank' ? WIDGET_COLORS.DANGER : WIDGET_COLORS.WARNING,
    };
  }
  const filters = Object.entries(record.readings?.filters ?? {}).sort((a, b) => a[1] - b[1]);
  if (filters.length === 0) {
    return null;
  }
  const [filter, hours] = filters[0];
  return {
    // "HEPA filter (hours left)" → "HEPA filter".
    label: names[filter].replace(/\s*\(.*\)$/, ''),
    icon: 'tool',
    value: `${Math.round(hours)} h`,
    color: WIDGET_COLORS.NEUTRAL,
  };
}

async function get(hub, { settings, language = 'en' }) {
  const record = settings?.device ? hub.resolveDevice(settings.device) : null;
  if (!record?.caps) {
    return message(settings?.device ? TEXT.unknown : TEXT.pick, language);
  }
  const { caps } = record;
  const readings = record.readings ?? { filters: {} };
  const ids = deviceIds(hub.gladys, record.deviceId);
  const on = readings.power === true;
  const reachable = record.reachable === true;

  const caption = [hub.label(record), record.host];
  if (!reachable) {
    caption.push(t(TEXT.unreachable, language));
  }
  const components = [{ type: 'text', variant: 'caption', text: caption.join(' · ') }];
  if (caps.pm25) {
    components.push({
      type: 'value',
      device_feature: ids.feature(FEATURE_KEYS.PM25),
      label: 'PM2.5',
      icon: 'wind',
    });
  }
  if (caps.humidity) {
    components.push({
      type: 'value',
      device_feature: ids.feature(FEATURE_KEYS.HUMIDITY),
      label: namesFor(language)[FEATURE_KEYS.HUMIDITY],
      icon: 'droplet',
    });
  }

  const items = [
    {
      label: namesFor(language)[FEATURE_KEYS.MODE],
      icon: 'power',
      value: on
        ? readings.mode
          ? optionLabel(readings.mode, language)
          : t(TEXT.turnOn, language)
        : t(TEXT.off, language),
      color: on ? WIDGET_COLORS.SUCCESS : WIDGET_COLORS.NEUTRAL,
    },
  ];
  if (typeof readings.allergenIndex === 'number') {
    const band = allergenBand(readings.allergenIndex);
    items.push({
      label: t(TEXT.airQuality, language),
      icon: 'activity',
      value: `${readings.allergenIndex} · ${t(band.text, language)}`,
      color: band.color,
    });
  }
  const boost = hub.boosts.get(record.deviceId);
  if (boost) {
    items.push({
      label: t(TEXT.boost, language),
      icon: 'zap',
      value: `${t(TEXT.until, language)} ${timeOf(boost.until, language)}`,
      color: WIDGET_COLORS.INFO,
    });
  }
  const maintenance = maintenanceItem(hub, record, language);
  if (maintenance) {
    items.push(maintenance);
  }
  components.push({ type: 'status', items });

  const modes = BUTTON_MODES.filter((mode) => caps.modes.includes(mode)).slice(0, MAX_MODE_BUTTONS);
  modes.forEach((mode, index) => {
    components.push({
      type: 'button',
      label: optionLabel(mode, language),
      icon: on && readings.mode === mode && !boost ? ACTIVE_ICON : 'play',
      style: 'secondary',
      // Numbered keys: the core drops a button whose action key is taken.
      action: { key: `${MODE_ACTION_PREFIX}${index + 1}`, params: { mode } },
    });
  });
  if (caps.modes.includes('turbo') || caps.speeds > 0) {
    components.push({
      type: 'button',
      label: `${t(TEXT.boost, language)} ${boostMinutes(settings)} min`,
      icon: boost ? ACTIVE_ICON : 'zap',
      style: 'secondary',
      action: { key: BOOST_ACTION },
    });
  }
  components.push({
    type: 'button',
    label: t(on ? TEXT.turnOff : TEXT.turnOn, language),
    icon: 'power',
    style: 'secondary',
    // The tap toggles the state the purifier has then, not the one shown.
    action: { key: POWER_ACTION },
  });
  return { ttl_seconds: 60, components };
}

async function action(hub, { actionKey, params = {}, settings }) {
  const device = settings?.device;
  if (!device) {
    throw new Error(TEXT.pick.en);
  }
  if (actionKey.startsWith(MODE_ACTION_PREFIX)) {
    await hub.setMode(device, String(params.mode));
    return {
      message: Object.fromEntries(
        Object.keys(TEXT.modeSet).map((language) => [
          language,
          `${TEXT.modeSet[language]}${optionLabel(String(params.mode), language)}`,
        ]),
      ),
    };
  }
  if (actionKey === BOOST_ACTION) {
    const minutes = boostMinutes(settings);
    await hub.startBoost(device, minutes);
    return { message: render(BOOST_TEXT.started, minutes) };
  }
  if (actionKey === POWER_ACTION) {
    const record = hub.require(device);
    const on = record.readings?.power !== true;
    await hub.switchPower(device, on);
    return { message: on ? TEXT.switchedOn : TEXT.switchedOff };
  }
  throw new Error(`Unknown action ${actionKey}`);
}

export const WIDGETS = {
  [WIDGET_KEY]: { get, action },
};
