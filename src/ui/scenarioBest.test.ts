// v0.12 Scenarios mode: the best result per scenario is kept in the settings (this device), only ever improved, and
// settings saved before Scenarios read as no results.

import { describe, expect, it, vi } from 'vitest';
import { createScenario, finish, scenarioDef } from '../engine/scenario';
import { autosaveSlot, AUTOSAVE_SLOT, SCENARIO_SLOT } from '../engine/save';
import { createGame } from '../engine/newGame';
import { settingsFrom, store } from './store';

describe('scenario best results', () => {
  it('older settings have none; stored ones survive', () => {
    expect(settingsFrom({}).scenarioBest).toEqual({});
    expect(settingsFrom({ scenarioBest: { cupFinal: { stars: 2, value: 12, at: 1 } } }).scenarioBest.cupFinal.stars).toBe(2);
  });

  it('records a finished run, and only a better one replaces it', () => {
    vi.stubGlobal('requestAnimationFrame', () => 0);
    vi.stubGlobal('cancelAnimationFrame', () => {});
    store.setSettings({ scenarioBest: {} });
    const g = createScenario('cupFinal');
    const d = scenarioDef(g)!;
    g.scen!.tally.fLegs = d.stars[1];
    finish(g, d);
    store.recordScenario(g);
    expect(store.settings.scenarioBest.cupFinal).toMatchObject({ stars: 2, value: d.stars[1] });
    const worse = createScenario('cupFinal');
    worse.scen!.tally.fLegs = d.stars[0];
    finish(worse, d);
    store.recordScenario(worse);
    expect(store.settings.scenarioBest.cupFinal.stars).toBe(2);
  });

  it('a scenario game autosaves to its own slot, never over the normal game', () => {
    expect(autosaveSlot(createScenario('ashCloud'))).toBe(SCENARIO_SLOT);
    expect(autosaveSlot(createGame({ name: 'T', code: 'TT', livery: { primary: '#000000', secondary: '#ffffff', tail: 'solid' }, base: 'LIS', seed: 1 }))).toBe(AUTOSAVE_SLOT);
  });
});
