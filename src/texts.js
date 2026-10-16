// -----------------------------------------------------------------------------
// Texts the integration sends to Gladys outside the widget (src/widgets.js):
// connection status, the "Check the purifiers" report, the maintenance trigger
// and the boost. Four languages, the four of the Gladys interface; German says
// "du", Spanish "usted". test/i18n.test.js checks every table.
// -----------------------------------------------------------------------------

export const INIT_FAILED = {
  en: 'Initialization failed, check the integration logs.',
  fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
  de: 'Initialisierung fehlgeschlagen, sieh dir die Protokolle der Integration an.',
  es: 'La inicialización ha fallado, consulte los registros de la integración.',
};

// Shown by Gladys under the integration name when it is not connected.
export const CONNECTION_TEXT = {
  noHost: {
    en: 'Enter the IP address of your Philips purifiers in the configuration.',
    fr: "Saisissez l'adresse IP de vos purificateurs Philips dans la configuration.",
    de: 'Gib die IP-Adresse deiner Philips-Luftreiniger in der Konfiguration ein.',
    es: 'Introduzca la dirección IP de sus purificadores Philips en la configuración.',
  },
  noAnswer: {
    en: 'No Philips purifier answers. Check its IP address and that it is on.',
    fr: "Aucun purificateur Philips ne répond. Vérifiez son adresse IP et qu'il est branché.",
    de: 'Kein Philips-Luftreiniger antwortet. Prüfe seine IP-Adresse und ob er eingesteckt ist.',
    es: 'Ningún purificador Philips responde. Compruebe su dirección IP y que está enchufado.',
  },
};

// The maintenance items of the trigger (values are permanent).
export const MAINTENANCE_ITEMS = [
  'pre-filter',
  'hepa-filter',
  'carbon-filter',
  'wick',
  'water-tank',
];

export const MAINTENANCE_TEXT = {
  en: {
    'pre-filter': 'Pre-filter to clean',
    'hepa-filter': 'HEPA filter to replace',
    'carbon-filter': 'Carbon filter to replace',
    wick: 'Wick to replace',
    'water-tank': 'Water tank empty',
    hoursLeft: (hours) => `${hours} h left`,
  },
  fr: {
    'pre-filter': 'Pré-filtre à nettoyer',
    'hepa-filter': 'Filtre HEPA à remplacer',
    'carbon-filter': 'Filtre à charbon à remplacer',
    wick: 'Mèche à remplacer',
    'water-tank': "Réservoir d'eau vide",
    hoursLeft: (hours) => `encore ${hours} h`,
  },
  de: {
    'pre-filter': 'Vorfilter reinigen',
    'hepa-filter': 'HEPA-Filter wechseln',
    'carbon-filter': 'Aktivkohlefilter wechseln',
    wick: 'Docht wechseln',
    'water-tank': 'Wassertank leer',
    hoursLeft: (hours) => `noch ${hours} h`,
  },
  es: {
    'pre-filter': 'Prefiltro por limpiar',
    'hepa-filter': 'Filtro HEPA por cambiar',
    'carbon-filter': 'Filtro de carbón por cambiar',
    wick: 'Mecha por cambiar',
    'water-tank': 'Depósito de agua vacío',
    hoursLeft: (hours) => `quedan ${hours} h`,
  },
};

const tableFor = (table, language) => table[language] ?? table.en;

/** "Bedroom (AC2729/10): HEPA filter to replace (12 h left)". */
export function maintenanceMessage(deviceLabel, item, hoursLeft, language) {
  const text = tableFor(MAINTENANCE_TEXT, language);
  const detail = hoursLeft > 0 ? ` (${text.hoursLeft(hoursLeft)})` : '';
  return `${deviceLabel}: ${text[item]}${detail}`;
}

export const BOOST_TEXT = {
  started: {
    en: (minutes) => `Turbo for ${minutes} min, then back to the previous mode.`,
    fr: (minutes) => `Turbo pendant ${minutes} min, puis retour au mode précédent.`,
    de: (minutes) => `Turbo für ${minutes} Min., dann zurück zum vorherigen Modus.`,
    es: (minutes) => `Turbo durante ${minutes} min, luego vuelve al modo anterior.`,
  },
};

/** One multi-language text from a table of functions. */
export const render = (table, ...args) =>
  Object.fromEntries(Object.entries(table).map(([language, fn]) => [language, fn(...args)]));

// The pieces of the "Check the purifiers" report, one table per language.
export const CHECK_TEXT = {
  en: {
    none: 'No IP address in the configuration.',
    count: (total, reachable) => `${total} address(es), ${reachable} answering:`,
    unreachable: 'not answering',
    unknownModel: 'model not in the list, no mode control',
    ignored: (list) => `Ignored addresses: ${list}.`,
  },
  fr: {
    none: 'Aucune adresse IP dans la configuration.',
    count: (total, reachable) => `${total} adresse(s), ${reachable} répondent :`,
    unreachable: 'ne répond pas',
    unknownModel: 'modèle hors liste, pas de commande de mode',
    ignored: (list) => `Adresses ignorées : ${list}.`,
  },
  de: {
    none: 'Keine IP-Adresse in der Konfiguration.',
    count: (total, reachable) => `${total} Adresse(n), davon ${reachable} erreichbar:`,
    unreachable: 'antwortet nicht',
    unknownModel: 'Modell nicht in der Liste, keine Modussteuerung',
    ignored: (list) => `Ignorierte Adressen: ${list}.`,
  },
  es: {
    none: 'No hay ninguna dirección IP en la configuración.',
    count: (total, reachable) => `${total} dirección(es), ${reachable} responden:`,
    unreachable: 'no responde',
    unknownModel: 'modelo fuera de la lista, sin control del modo',
    ignored: (list) => `Direcciones ignoradas: ${list}.`,
  },
};

const MAX_LISTED = 6;

/**
 * The report shown under the "Check the purifiers" button, in every language.
 * @param {{ hosts: Array<{ host: string, label: string|null, reachable: boolean,
 *   known: boolean }>, invalidHosts: string[] }} summary
 */
export function checkMessage(summary) {
  return Object.fromEntries(
    Object.entries(CHECK_TEXT).map(([language, text]) => {
      const lines = [];
      if (summary.hosts.length === 0) {
        lines.push(text.none);
      } else {
        const reachable = summary.hosts.filter((entry) => entry.reachable).length;
        lines.push(text.count(summary.hosts.length, reachable));
        const list = summary.hosts.slice(0, MAX_LISTED).map((entry) => {
          const details = [];
          if (!entry.reachable) {
            details.push(text.unreachable);
          } else if (!entry.known) {
            details.push(text.unknownModel);
          }
          const name = entry.label ? `${entry.label} ` : '';
          return `${name}${entry.host}${details.length ? ` (${details.join(', ')})` : ''}`;
        });
        lines.push(`${list.join(', ')}${summary.hosts.length > MAX_LISTED ? '…' : '.'}`);
      }
      if (summary.invalidHosts.length > 0) {
        lines.push(text.ignored(summary.invalidHosts.slice(0, 3).join(', ')));
      }
      return [language, lines.join(' ')];
    }),
  );
}
