// v0.19 (perf) a pan, pinch or fling on the Map holds back the clock's hourly re-render of the screens until it ends
// (at most GESTURE_HOLD_MS): the game time runs on, the refresh comes once when the fingers lift.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { takeCueEvents } from '../engine/core/cues';
import { fixtureGame } from '../engine/crew/fixtures';
import { sound } from './sound';
import { store } from './store';

const frame = (dt: number) => (store as unknown as { frame(dt: number): void }).frame(dt);

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', () => 0);
  vi.stubGlobal('cancelAnimationFrame', () => {});
  vi.spyOn(sound, 'event').mockImplementation(() => {});
});
afterEach(() => {
  store.mapGesture(false);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('v0.19 map gesture refresh hold', () => {
  it('no hourly re-render while a map gesture runs; one when it ends; time runs on meanwhile', () => {
    const g = fixtureGame(5);
    store.loadGame(g);
    store.modal = null;
    store.setSettings({ autoPause: Object.fromEntries(Object.keys(store.settings.autoPause).map((k) => [k, false])) as typeof store.settings.autoPause });
    store.setSpeed(4);
    takeCueEvents();
    let emits = 0;
    const off = store.subscribe(() => { emits++; });
    try {
      // Without a gesture: an hour of game time (4×: ~9.6 game minutes per 100 ms) re-renders.
      const t0 = g.now;
      for (let i = 0; i < 8; i++) frame(100);
      expect(g.now - t0).toBeGreaterThanOrEqual(60);
      expect(emits).toBeGreaterThan(0);
      // A gesture: time runs, nothing re-renders.
      emits = 0;
      store.mapGesture(true);
      const t1 = g.now;
      for (let i = 0; i < 8; i++) frame(100);
      expect(g.now - t1).toBeGreaterThanOrEqual(60);
      expect(emits).toBe(0);
      // It ends: one refresh, at once.
      store.mapGesture(false);
      expect(emits).toBe(1);
      // A second end sends nothing more.
      store.mapGesture(false);
      expect(emits).toBe(1);
    } finally {
      off();
    }
  });

  it('a gesture whose end is never seen holds the refresh back for a few seconds at most', () => {
    const g = fixtureGame(5);
    store.loadGame(g);
    store.modal = null;
    store.setSettings({ autoPause: Object.fromEntries(Object.keys(store.settings.autoPause).map((k) => [k, false])) as typeof store.settings.autoPause });
    store.setSpeed(4);
    let now = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    let emits = 0;
    const off = store.subscribe(() => { emits++; });
    try {
      store.mapGesture(true);
      emits = 0;
      for (let i = 0; i < 8; i++) frame(100);
      expect(emits).toBe(0);
      now += 3000;
      for (let i = 0; i < 8; i++) frame(100);
      expect(emits).toBeGreaterThan(0);
    } finally {
      off();
    }
  });
});
