// v0.9.1 (§S.6): chimes always mean something. Every cue kind arrives with its note and shows it as a toast before it
// plays; a cue without a note never reaches the sound set.

import { describe, expect, it, vi } from 'vitest';
import { CUES, cue, takeCueEvents } from '../engine/core/cues';
import { sound } from './sound';
import { store, TOAST_MS } from './store';
import { LOG_MAX, logToast, pushStack, shownToasts, stickyCue, toastMs, withoutOpenSubject, type ToastLogEntry } from './toastLogic';

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
  it('stay a while (v0.12.1: news 8 s), and a tap dismisses one at once', () => {
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

describe('v0.12.1 toasts wait for the reader', () => {
  it('news 8 s, warnings and bad news 15 s, the urgent alarms until closed', () => {
    expect(toastMs('info')).toBe(8000);
    expect(toastMs('good')).toBe(8000);
    expect(toastMs('warn')).toBe(15000);
    expect(toastMs('bad')).toBe(15000);
    expect(toastMs('bad', true)).toBeNull();
    expect(stickyCue('crewShortage')).toBe(true);
    expect(stickyCue('message')).toBe(false);
  });

  it('a held toast (hover, touch) stays while held and keeps what it had left after, 3 s at least', () => {
    vi.useFakeTimers();
    store.toasts = [];
    store.toast('warn', 'Hold me');
    const [t] = store.toasts;
    vi.advanceTimersByTime(14000);
    store.holdToast(t.id, true);
    vi.advanceTimersByTime(60_000);
    expect(store.toasts.find((x) => x.id === t.id)?.leaving).toBeFalsy();
    store.holdToast(t.id, false);
    vi.advanceTimersByTime(2900);
    expect(store.toasts.find((x) => x.id === t.id)?.leaving).toBeFalsy();
    vi.advanceTimersByTime(200);
    expect(store.toasts.find((x) => x.id === t.id)?.leaving).toBe(true);
    vi.useRealTimers();
  });

  it('a sticky one stays until closed; the stack drops the oldest that may go; every toast lands in the log', () => {
    vi.useFakeTimers();
    store.toasts = [];
    store.toastLog = [];
    store.toast('bad', 'Alarm', 'crew', { sticky: true });
    for (const n of ['A', 'B', 'C']) store.toast('info', n);
    vi.advanceTimersByTime(120_000);
    expect(store.toasts.filter((x) => !x.leaving).map((x) => x.title)).toEqual(['Alarm']);
    expect(store.toastLog.map((x) => x.title)).toEqual(['C', 'B', 'A', 'Alarm']);
    vi.useRealTimers();
    expect(pushStack([{ id: 1, sticky: true }, { id: 2 }, { id: 3 }], { id: 4 }).map((x) => x.id)).toEqual([1, 3, 4]);
    // A phone on its side: the alarm and the newest.
    expect(shownToasts([{ id: 1, sticky: true }, { id: 2 }, { id: 3 }], 2).map((x) => x.id)).toEqual([1, 3]);
    let log: ToastLogEntry[] = [];
    for (let i = 0; i < LOG_MAX + 10; i++) log = logToast(log, { id: i, kind: 'info', title: `T${i}`, at: i * 10 });
    expect(log.length).toBe(LOG_MAX);
    expect(log[0].title).toBe(`T${LOG_MAX + 9}`);
  });
});

describe('v0.12.1 what a dialog shows', () => {
  it('has no toast about it over its title ("Decision: …", "New offer: …"); other toasts stay', () => {
    const list = [
      { id: 1, title: "Decision: CS-TQM can't reach Manchester for Jet2holidays: sub-charter or swap aircraft" },
      { id: 2, title: 'BLU1570 still short', ref: { kind: 'flight' as const, id: 'f1' } },
      { id: 3, title: 'New offer: Hajj 1449 airlift CMN–JED/MED', ref: { kind: 'offer' as const, id: 'o9' } },
    ];
    expect(withoutOpenSubject(list, { title: "CS-TQM can't reach Manchester for Jet2holidays: sub-charter or swap aircraft" }).map((t) => t.id)).toEqual([2, 3]);
    expect(withoutOpenSubject(list, { ref: { kind: 'offer', id: 'o9' } }).map((t) => t.id)).toEqual([1, 2]);
    expect(withoutOpenSubject(list, { ref: { kind: 'flight', id: 'f1' } }).map((t) => t.id)).toEqual([1, 3]);
    expect(withoutOpenSubject(list, null).map((t) => t.id)).toEqual([1, 2, 3]);
  });
});
