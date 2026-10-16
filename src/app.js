// -----------------------------------------------------------------------------
// Registers every SDK handler on a GladysIntegration (or the SDK's fake) and
// returns the hub, so index.js stays a few lines and the tests drive the very
// same wiring.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { normalizeConfig } from './config.js';
import { PhilipsHub } from './hub.js';
import { CoapEndpoint } from './philips/endpoint.js';
import { SCENE_ACTIONS } from './scenes.js';
import { Store } from './store.js';
import { INIT_FAILED, checkMessage } from './texts.js';
import { WIDGETS } from './widgets.js';

const logger = createLogger({ name: 'philips-air-app' });

// The fallback onPoll skips a purifier read less than half a period ago by
// the hub's own timer.
const recentlyRead = new WeakMap();

/**
 * @param {object} gladys GladysIntegration instance
 * @param {object} [options] test seams: store, createSocket, timers, timings, endpointTimings
 */
export function registerHandlers(gladys, options = {}) {
  const endpoint = new CoapEndpoint({
    createSocket: options.createSocket,
    timings: options.endpointTimings,
    logger: createLogger({ name: 'philips-air-coap' }),
  });
  const hub = new PhilipsHub({
    gladys,
    store: options.store ?? new Store(),
    endpoint,
    timers: options.timers ?? true,
    timings: options.timings,
  });

  // Resolved once the hub has started; every handler waits for it, so a
  // command arriving during the first reads is not lost.
  let resolveReady;
  const ready = new Promise((resolve) => {
    resolveReady = resolve;
  });
  let started = false;
  const whenReady =
    (fn) =>
    async (...args) => {
      await ready;
      return fn(...args);
    };

  gladys.on('connected', async () => {
    try {
      const config = normalizeConfig(await gladys.getConfig());
      if (started) {
        // A reconnection (Gladys restarted): re-sync what Gladys may have lost.
        await hub.resync(config);
        return;
      }
      started = true;
      await hub.start(config);
    } catch (err) {
      logger.error('Initialization failed', err);
      await gladys.setConnectionStatus(false, INIT_FAILED).catch(() => {});
    } finally {
      resolveReady();
    }
  });

  gladys.onScanRequest(
    whenReady(async () => {
      await hub.check();
    }),
  );

  gladys.onSetValue(whenReady((device, feature, value) => hub.setValue(device, feature, value)));

  // The devices are published with should_poll: false (read by the hub's own
  // timer, see Gladys#3198); this only serves a Gladys that would poll anyway.
  gladys.onPoll(
    whenReady(async (device) => {
      const record = hub.resolveDevice(device?.external_id);
      const link = record ? hub.linkOf(record) : null;
      if (!link) {
        return;
      }
      const last = recentlyRead.get(link) ?? 0;
      if (Date.now() - last < (hub.config.pollSeconds * 1000) / 2) {
        return;
      }
      recentlyRead.set(link, Date.now());
      await hub.refresh(link);
    }),
  );

  gladys.onDeviceCreated(whenReady((device) => hub.onDeviceCreated(device)));

  gladys.onConfigUpdated(
    whenReady(async (newConfig) => {
      await hub.reconfigure(normalizeConfig(newConfig));
    }),
  );

  gladys.onAction(
    'check',
    whenReady(async () => checkMessage(await hub.check())),
  );

  for (const [key, handler] of Object.entries(SCENE_ACTIONS)) {
    gladys.onSceneAction(
      key,
      whenReady((fields) => handler(hub, { fields })),
    );
  }

  for (const [key, widget] of Object.entries(WIDGETS)) {
    gladys.onWidgetGet(
      key,
      whenReady((request) => widget.get(hub, request)),
    );
    gladys.onWidgetAction(
      key,
      whenReady((actionKey, params, context = {}) =>
        widget.action(hub, { actionKey, params, ...context }),
      ),
    );
  }

  return {
    hub,
    ready,
    stop: () => hub.stop(),
  };
}
