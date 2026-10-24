// v0.9 round 4 (§S): the UI store's own sound events.

import { describe, expect, it, vi } from 'vitest';
import { sound } from './sound';
import { store } from './store';
import { addCrew, fixtureGame } from '../engine/crew/fixtures';

describe('store speed and pause sounds', () => {
  it('a speed button that leaves the paused state is a resume (one LOW chime); one that only changes the speed is silent', () => {
    const spy = vi.spyOn(sound, 'event').mockImplementation(() => {});
    store.paused = true;
    store.setSpeed(2);
    expect(spy.mock.calls.filter((c) => c[0] === 'resume')).toHaveLength(1);
    spy.mockClear();
    store.setSpeed(4);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('round 4: the autosave is what the next frame would start from', () => {
  it('a crew member whose rest has just expired is settled (available) before the state is serialized', () => {
    vi.stubGlobal('requestAnimationFrame', () => 0);
    vi.stubGlobal('cancelAnimationFrame', () => {});
    const g = fixtureGame(5);
    const [id] = addCrew(g, { CC: 1 });
    store.loadGame(g);
    const c = g.crew[id];
    c.status = 'resting';
    c.restUntil = g.now - 1;
    // The next game hour (the status refresh runs once an hour): a save here must not freeze the stale status.
    g.now += 60;
    store.saveAuto(true);
    expect(c.status).toBe('available');
    store.quitToTitle();
    vi.unstubAllGlobals();
  });
});
