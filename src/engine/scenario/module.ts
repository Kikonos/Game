// v0.12 Scenarios mode: the simulation module. Deliberately tiny (no imports beyond types) so sim.ts can list it
// without an import cycle; the daily work lives in scenario/index.ts, which registers itself in SCEN_HOOKS when it
// loads (save.ts imports it, so a loaded scenario game always has it). A normal game has no `g.scen`: nothing runs.

import type { SimModule } from '../core/module';
import type { GameState } from '../core/types';

export const SCEN_HOOKS: { day?: (g: GameState) => void } = {};

export const scenarioModule: SimModule = {
  name: 'scenario',
  load(g) {
    // v0.12 every game names its scenario ('startup' = the normal game).
    g.scenario ??= 'startup';
  },
  handlers: {
    day: (g) => {
      if (g.scen && !g.scen.result) SCEN_HOOKS.day?.(g);
    },
  },
};
