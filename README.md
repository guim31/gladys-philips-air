# Philips Air for Gladys Assistant

A [Gladys Assistant](https://gladysassistant.com) integration for connected **Philips air purifiers and
humidifiers**, over their **local encrypted CoAP protocol**: no Philips account, no cloud.

> **Developed without the hardware: feedback welcome.** Everything was built from the protocol documented by
> the open-source community and tested against a simulated purifier (`test/helpers/fakePhilips.js`). Please
> report what your model does in the [issues](https://github.com/guim31/gladys-philips-air/issues).
>
> Not affiliated with, endorsed by or connected to Philips or Versuni. Philips is a trademark of Koninklijke
> Philips N.V.

## Features

One Gladys device per purifier, with only what its model has:

- **Air quality**: PM2.5 (µg/m³), Philips allergen index (1-12), humidity and temperature on the models that
  measure them.
- **Controls**: power, mode (auto, allergen, bacteria, sleep, allergy sleep, gentle, turbo, manual… per
  model), manual fan speed, target humidity and humidification on/off (humidifiers), child lock, display
  light.
- **Maintenance**: hours left on the pre-filter, HEPA, carbon filter and wick; water tank state.
- **Changes pushed by the purifier** (CoAP observe), with an internal read every 30 s as a safety net.
- **Scene trigger** _Purifier maintenance needed_: once per item (pre-filter to clean, filter or wick to
  replace, empty tank), with a ready-made message, re-armed when done.
- **Scene action** _Boost the purifier_: turbo for N minutes, then back to the previous mode (or off).
- **Dashboard widget**: allergen index on the Philips scale, filter status, boost, one-tap modes.
- Four languages: English, French, German, Spanish.

Supported models: AC2729, AC2889, AC2936, AC2939, AC2958, AC2959, AC3021, AC3033, AC3036, AC3039, AC3055,
AC3059, AC3259, AC3829, AC3854, AC3858, AC4231, AC4236, AC5659, AC5660, AC1715, AC0850, AC0950, AC0951,
AC2210, AC2220, AC2221, AC3210, AC3220, AC3221, AC3420, AC3421, AC4220, AC4221, HU1509, HU1510, HU4209, HU4210,
HU5710. Other models of the same generations get their sensors, power and filters, without the mode list.

## Requirements

- Gladys Assistant **5.1.0** or later.
- The purifier set up in the Philips Air+ app, on the same network as Gladys, with a fixed IP address.

## Installation

In Gladys: **Integrations → Install from GitHub**, `https://github.com/guim31/gladys-philips-air` (or install
it from the store once listed). Then, in its **Configuration** tab, enter the IP address of each purifier, save,
and add the devices from the **Discovery** tab. Full guide: [English](docs/en.md), [Français](docs/fr.md),
[Deutsch](docs/de.md), [Español](docs/es.md).

## How it works

- `src/philips/coap.js` and `endpoint.js`: a small CoAP client (RFC 7252, observe, block-wise) over one UDP
  socket, without dependencies.
- `src/philips/crypto.js`: the AES-128-CBC + SHA-256 scheme of the protocol (counter from
  `POST /sys/dev/sync`, key and IV from MD5("JiangPan" + counter)), checked against vectors produced by
  aioairctrl.
- `src/philips/client.js`: one session per purifier: sync, status read (which also refreshes the CoAP
  observation), commands, re-sync on refusal.
- `src/philips/models.js`: the three key generations of the firmware (`pwr`/`mode`/`om`, `D03-02`…, `D03102`…)
  and the mode/speed families per model.
- `src/hub.js`: reading timer, pushed statuses, Gladys states (deduplicated, heartbeat), unreachable
  detection, maintenance trigger, boost.

The Gladys sandbox runs integrations on a Docker bridge: no broadcast or mDNS, but unicast UDP to a LAN
address goes through. Hence the IP addresses in the configuration. Gladys never polls the devices
(`should_poll: false`, see GladysAssistant/Gladys#3198): the container reads them itself.

## Checked, and what was not

Checked here: the unit and end-to-end tests (`npm test`) against the SDK's fake Gladys and a fake purifier;
the encryption against aioairctrl's reference implementation and against two real device captures published by
aioairctrl; the probe script against the fake purifier over real UDP.

Not checked: a real purifier, a real Gladys instance, the CoAP push through the Docker NAT of a real install.
`scripts/probe.mjs <ip>` reads a real purifier with the integration's own code (read-only, identifiers masked).

## Limitations

- Local CoAP only: the old HTTP-only models and the firmware that closed the local access are not supported.
- No automatic discovery: enter the IP addresses.
- Mode tables come from community observations; timers, beep, ambient light and the preferred index are not
  exposed. The heaters and fans of the same family (CX, AMF) are left out on purpose: heating is not something to
  drive blindly.
- The firmware of these purifiers is known to stop answering local requests after a while; a power cycle of the
  purifier fixes it, and the integration reconnects by itself.

## Development

```bash
npm ci
npm run format:check
npm run lint
npm test
node tools/fake-philips.mjs classic-ac2889-10 5683   # a fake purifier on UDP 5683
node scripts/probe.mjs 127.0.0.1                     # read it like a real one
```

Releases go through **Actions → Release** (see `CLAUDE.md`).

## Credits

- [py-air-control](https://github.com/rgerganov/py-air-control) by Radoslav Gerganov (MIT): the reverse
  engineering of the protocol, and the real statuses used as fixtures.
- [aioairctrl](https://github.com/kongo09/aioairctrl) by betaboon and kongo09 (MIT): the reference client;
  encryption test vectors and device captures.
- [philips-airpurifier-coap](https://github.com/kongo09/philips-airpurifier-coap) by kongo09 and contributors,
  the Home Assistant integration: the model knowledge (read, not copied: the repository carries no licence for
  its code).

## License

[Apache-2.0](LICENSE)
