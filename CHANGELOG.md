# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- Philips air purifiers and humidifiers on the local network (encrypted CoAP, UDP 5683): one Gladys device per
  purifier with power, mode, fan speed, PM2.5, allergen index, humidity, temperature, target humidity,
  humidification, water tank, child lock, display light, and the hours left on the pre-filter, HEPA filter,
  carbon filter and wick, depending on the model.
- Three firmware generations (classic AC series, AC1715/AC0850, new generation AC/HU) and the mode lists of
  about forty models; other models get their sensors, power and filters.
- Changes made on the purifier or in the Philips app pushed to Gladys (CoAP observe), with a read every 30 s
  as a safety net.
- Scene trigger "Purifier maintenance needed", once per item with a ready-made message.
- Scene action "Boost the purifier": turbo for a while, then back to the previous mode.
- Dashboard widget: allergen index on the Philips scale, filters, boost and one-tap modes.
- "Check the purifiers" button in the configuration.
- Documentation in English, French, German and Spanish.

[Unreleased]: https://github.com/guim31/gladys-philips-air/commits/main
