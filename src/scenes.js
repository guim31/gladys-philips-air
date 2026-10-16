// -----------------------------------------------------------------------------
// Scene action handlers (manifest `scene_actions`, Gladys 5.1+).
//
// Power, mode and speed are already Gladys scene actions on the device
// features. What they cannot do is put the purifier back as it was: the
// boost runs it at full speed for a while (after cooking, when coming home,
// while vacuuming) and then returns it to its mode, or switches it off if it
// was off, unless someone changed it meanwhile.
//
// The maintenance trigger (`maintenance_needed`) is fired by the hub
// (src/hub.js), never as a consequence of this action.
// -----------------------------------------------------------------------------

import { BOOST_ACTION } from './hub.js';

export const SCENE_ACTIONS = {
  async [BOOST_ACTION](hub, { fields }) {
    const until = await hub.startBoost(fields.device, fields.minutes);
    return { until: until.toISOString() };
  },
};
