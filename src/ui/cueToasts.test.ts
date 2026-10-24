// v0.9.1 (§S.6): chimes always mean something. Every cue kind arrives with its note and shows it as a toast before it
// plays; a cue without a note never reaches the sound set.

import { describe, expect, it, vi } from 'vitest';
import { CUES, cue, takeCueEvents } from '../engine/core/cues';
import { sound } from './sound';
import { store, TOAST_MS } from './store';

describe('v0.9.1 every cue comes with its message', () => {
  it('each cue kind shows a toast naming it, and only then plays', () => {
    takeCueEvents();
    sound.configure({ on: true, cats: { alerts: true, chimes: true, flights: true, ui: true } });
    const played: string[] = [];
    const spy = vi.spyOn(sound, 'event').mockImplementation((e) => void played.push(e));
    for (const c of CUES) {
      store.toasts = [];
      played.length = 0;
      cue(c, { title: `What it is: ${c}`, tone: 'info' });
      store.emit();
      expect(store.toasts.map((t) => t.title), c).toContain(`What it is: ${c}`);
      expect(played, c).toEqual([c]);
    }
    spy.mockRestore();
  });

  it('a cue without a title is dropped: no toast, no sound', () => {
    takeCueEvents();
    const spy = vi.spyOn(sound, 'event').mockImplementation(() => {});
    store.toasts = [];
    cue('aog', { title: '' });
    cue('offerNew', { title: '   ' });
    store.emit();
    expect(store.toasts).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('a cue the settings silence plays nothing (its toast follows the quiet rules)', () => {
    takeCueEvents();
    sound.configure({ on: true, cats: { alerts: true, chimes: true, flights: false, ui: true } });
    const spy = vi.spyOn(sound, 'event').mockImplementation(() => {});
    store.toasts = [];
    cue('flightDep', { title: 'TP1 departed' });
    store.emit();
    expect(spy).not.toHaveBeenCalled();
    expect(store.toasts).toEqual([]);
    spy.mockRestore();
  });
});

describe('v0.9.1 toasts', () => {
  it('stay 5 s, and a tap dismisses one at once', () => {
    vi.useFakeTimers();
    store.toasts = [];
    store.toast('info', 'One');
    store.toast('info', 'Two');
    const [a] = store.toasts;
    store.dismissToast(a.id);
    expect(store.toasts.find((t) => t.id === a.id)?.leaving).toBe(true);
    vi.advanceTimersByTime(300);
    expect(store.toasts.map((t) => t.title)).toEqual(['Two']);
    vi.advanceTimersByTime(TOAST_MS - 400);
    expect(store.toasts.map((t) => t.title)).toEqual(['Two']);
    vi.advanceTimersByTime(200);
    expect(store.toasts.find((t) => t.title === 'Two')?.leaving).toBe(true);
    vi.useRealTimers();
  });
});
