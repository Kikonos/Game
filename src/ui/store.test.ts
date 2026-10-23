// v0.9 round 4 (§S): the UI store's own sound events.

import { describe, expect, it, vi } from 'vitest';
import { sound } from './sound';
import { store } from './store';

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
