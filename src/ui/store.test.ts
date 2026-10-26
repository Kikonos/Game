// v0.9 round 4 (§S): the UI store's own sound events.

import { describe, expect, it, vi } from 'vitest';
import { sound } from './sound';
import { store } from './store';
import { addCrew, fixtureGame } from '../engine/crew/fixtures';

describe('store speed and pause sounds', () => {
  it('v0.9.1: pause and resume make no sound at all (speed buttons, the pause button)', () => {
    const spy = vi.spyOn(sound, 'event').mockImplementation(() => {});
    store.paused = true;
    store.setSpeed(2);
    store.setSpeed(4);
    store.togglePause();
    store.togglePause();
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

describe('v0.10.2 the phone call pop-up', () => {
  it('stops the clock at once, waits its turn behind an open dialog, never toasts, and is skipped once the offer is gone', async () => {
    vi.stubGlobal('requestAnimationFrame', () => 0);
    vi.stubGlobal('cancelAnimationFrame', () => {});
    const { cue, takeCueEvents } = await import('../engine/core/cues');
    const { offer } = await import('../engine/contracts/testkit');
    const g = fixtureGame(6);
    store.loadGame(g);
    store.modal = null;
    const o = offer(g, 'aogCover', { start: g.now + 24 * 60 });
    takeCueEvents();
    const spy = vi.spyOn(sound, 'event').mockImplementation(() => {});
    // Running, nothing open: the call card shows and the game pauses (whatever the auto-pause settings say).
    store.paused = false;
    store.toasts = [];
    cue('offerCall', { title: `Phone call: ${o.title}`, ref: { kind: 'offer', id: o.id } });
    store.emit();
    expect(store.modal).toEqual({ kind: 'offerCall', offerId: o.id });
    expect(store.paused).toBe(true);
    expect(store.toasts).toEqual([]);
    // The ring is the card's (CallModal plays it while it shows), not the drain's.
    expect(spy).not.toHaveBeenCalledWith('offerCall');
    store.closeModal();
    expect(store.modal).toBeNull();
    expect(store.paused).toBe(true);
    // Another dialog open: the call waits its turn (still paused), then shows when that one closes.
    store.paused = false;
    store.openModal({ kind: 'menu' });
    cue('offerCall', { title: `Phone call: ${o.title}`, ref: { kind: 'offer', id: o.id } });
    store.emit();
    expect(store.modal).toEqual({ kind: 'menu' });
    expect(store.paused).toBe(true);
    store.closeModal();
    expect(store.modal).toEqual({ kind: 'offerCall', offerId: o.id });
    store.closeModal();
    // Answered elsewhere meanwhile: no card.
    store.openModal({ kind: 'menu' });
    cue('offerCall', { title: `Phone call: ${o.title}`, ref: { kind: 'offer', id: o.id } });
    store.emit();
    o.status = 'declined';
    store.closeModal();
    expect(store.modal).toBeNull();
    spy.mockRestore();
    store.quitToTitle();
    vi.unstubAllGlobals();
  });
});
