// v0.15 auto-resume: a pause the game made lifts by itself once what it asked for is done, at the speed it had.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { takeCueEvents } from '../engine/core/cues';
import { offer } from '../engine/contracts/testkit';
import { declineCall, declineOffer } from '../engine/contracts';
import { pushDecision } from '../engine/core/messages';
import type { GameState } from '../engine/core/types';
import { autoRoster } from '../engine/crew';
import { fixtureGame } from '../engine/crew/fixtures';
import { demoFlights } from '../engine/dev';
import { resolveDecision } from '../engine/ops/events';
import { hireHead, setHeadRules, unlockHead } from '../engine/ops/heads';
import { deserialize, serialize } from '../engine/save';
import { advanceTo } from '../engine/sim';
import { addItem, DEFAULT_RESUME, holdFromSave, holdToSave, pendingItems, subjectsOf, topReason, type Hold } from './autoResume';
import { sound } from './sound';
import { store } from './store';

const sample = (g: GameState, title = 'Sample') =>
  pushDecision(g, { kind: 'dev', title, body: 'x', defaultOption: 'b', expires: g.now + 360, options: [{ id: 'a', label: 'A', desc: '' }, { id: 'b', label: 'B', desc: '' }] });
const answer = (id: string) => store.act((gg) => resolveDecision(gg, id, 'a'), { toastOk: false });
/** The game's own pause, the way the clock raises it (frame → autoPause). */
const autoPause = (r: Parameters<typeof subjectsOf>[1], keys?: string[]) => (store as unknown as { autoPause(r: string, k?: string[]): void }).autoPause(r, keys);

function start(speed: 1 | 2 | 4 = 4): GameState {
  const g = fixtureGame(5);
  store.loadGame(g);
  store.modal = null;
  store.setSpeed(speed);
  takeCueEvents();
  return g;
}

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', () => 0);
  vi.stubGlobal('cancelAnimationFrame', () => {});
  vi.spyOn(sound, 'event').mockImplementation(() => {});
});
afterEach(() => {
  store.quitToTitle();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('v0.15 a decision the game paused for', () => {
  it('answered: the clock runs again at the speed it had, with no pause badge', () => {
    start(4);
    const id = store.dev.decision()!;
    expect(store.paused).toBe(true);
    expect(store.pauseReason).toBe('decision');
    expect(store.hold?.resume).toBe(4);
    answer(id);
    expect(store.paused).toBe(false);
    expect(store.speed).toBe(4);
    expect(store.pauseReason).toBeNull();
    expect(store.hold).toBeNull();
    expect(store.blocked).toBe(false);
    expect(store.running).toBe(true);
  });

  it('two at once: only the last answer lets the clock go', () => {
    const g = start(2);
    const a = sample(g, 'One');
    const b = sample(g, 'Two');
    autoPause('decision');
    answer(a.id);
    expect(store.paused).toBe(true);
    expect(store.blocked).toBe(true);
    answer(b.id);
    expect(store.paused).toBe(false);
    expect(store.speed).toBe(2);
  });

  it('a pause the player made (before, or Space twice during) stays after the answer', () => {
    const g = start(4);
    store.togglePause();
    const a = sample(g);
    autoPause('decision');
    expect(store.hold?.resume).toBeNull();
    answer(a.id);
    expect(store.paused).toBe(true);
    expect(store.pauseReason).toBeNull();
    // During: Space (go on once answered), Space (stay paused).
    store.setSpeed(4);
    const b = sample(g);
    autoPause('decision');
    store.togglePause();
    expect(store.paused).toBe(false);
    store.togglePause();
    expect(store.paused).toBe(true);
    answer(b.id);
    expect(store.paused).toBe(true);
    expect(store.pauseReason).toBeNull();
  });

  it('Look first, the Inbox dialog closed unanswered, an unrelated dialog: still waiting and paused', () => {
    const g = start(4);
    const a = sample(g);
    autoPause('decision');
    store.deferDecision();
    store.openModal({ kind: 'decision', decisionId: a.id });
    store.closeModal();
    store.openModal({ kind: 'menu' });
    store.closeModal();
    expect(store.paused).toBe(true);
    expect(store.hold?.items).toEqual([{ reason: 'decision', keys: [a.id] }]);
    answer(a.id);
    expect(store.paused).toBe(false);
  });

  it('answered by another path (operations, a direct update): the badge clears at the next look', () => {
    const g = start(4);
    const a = sample(g);
    autoPause('decision');
    store.update((gg) => { gg.decisions = gg.decisions.filter((d) => d.id !== a.id); });
    expect(store.paused).toBe(false);
    expect(store.pauseReason).toBeNull();
  });
});

describe('v0.15 phone calls and stacked reasons', () => {
  it('a call stacked on a decision: the badge names the call once the decision is answered; declining it resumes', () => {
    const g = start(4);
    const a = sample(g);
    autoPause('decision');
    const o = offer(g, 'aogCover', { start: g.now + 24 * 60 });
    o.urgency = 'urgent';
    o.call = true;
    autoPause('urgentOffer', [o.id]);
    expect(store.heldCall).toBe(o.id);
    answer(a.id);
    expect(store.paused).toBe(true);
    expect(store.pauseReason).toBe('urgentOffer');
    // Put away unanswered: still waiting.
    store.openModal({ kind: 'offerCall', offerId: o.id });
    store.closeModal();
    expect(store.paused).toBe(true);
    store.act((gg) => declineCall(gg, o.id), { toastOk: false });
    expect(store.paused).toBe(false);
    expect(store.speed).toBe(4);
    expect(store.pauseReason).toBeNull();
  });

  it('a note (month closed) waits for Play, and holds the clock after the decision beside it is answered', () => {
    const g = start(4);
    const a = sample(g);
    autoPause('decision');
    autoPause('monthEnd');
    answer(a.id);
    expect(store.paused).toBe(true);
    expect(store.pauseReason).toBe('monthEnd');
    store.togglePause();
    expect(store.paused).toBe(false);
    expect(store.hold).toBeNull();
  });

  it('a speed button during the hold is the player taking over: no hold left', () => {
    const g = start(4);
    sample(g);
    autoPause('decision');
    store.setSpeed(1);
    expect(store.hold).toBeNull();
    expect(store.paused).toBe(false);
    expect(store.blocked).toBe(true);
  });
});

describe('v0.15 watch-desk rules set to Pause', () => {
  it('the pause is about the new subject (an old one still live is not waited on); answering the offer resumes', () => {
    const g = fixtureGame(5);
    unlockHead(g, 'watch');
    hireHead(g, 'watch', 2);
    setHeadRules(g, 'watch', { alerts: [
      { id: 'r1', kind: 'cashBelow', value: 1e12, action: 'pause', on: true },
      { id: 'r2', kind: 'offerOver', value: 0, action: 'pause', on: true },
    ] });
    store.loadGame(g);
    store.modal = null;
    store.setSpeed(4);
    const o = offer(g, 'adhoc', { start: g.now + 5 * 24 * 60 });
    autoPause('rule');
    expect(store.hold?.items).toEqual([{ reason: 'rule', keys: [`r2:${o.id}`] }]);
    store.act((gg) => declineOffer(gg, o.id), { toastOk: false });
    expect(store.paused).toBe(false);
    expect(store.speed).toBe(4);
  });
});

describe('v0.15 crew alarms', () => {
  it('a crew shortage pause lifts when the short flight is dealt with', () => {
    const g = fixtureGame(9);
    demoFlights(g, undefined, 3, 'revenue');
    autoRoster(g);
    advanceTo(g, g.now + 6 * 60);
    store.loadGame(g);
    store.modal = null;
    store.setSpeed(2);
    const id = store.dev.crewShortage(24);
    expect(id).toBeTruthy();
    store.modal = null;
    expect(store.paused).toBe(true);
    const it = store.hold?.items.find((x) => x.reason === 'crewShortage');
    expect(it?.keys).toContain(id);
    // Dealt with (here the flight is cancelled; Crew Control's fixes clear the shortage the same way).
    store.update((gg) => {
      for (const k of it!.keys) gg.flights[k].status = 'cancelled';
    });
    expect(store.paused).toBe(false);
    expect(store.speed).toBe(2);
  });
});

describe('v0.15 a crew card dealt with in Crew Control', () => {
  it("the gate's crew-short card is withdrawn once the leg is handled: no 'Decision waiting' left, the clock runs", () => {
    const g = fixtureGame(9);
    demoFlights(g, undefined, 3, 'revenue');
    autoRoster(g);
    advanceTo(g, g.now + 6 * 60);
    store.loadGame(g);
    store.modal = null;
    store.setSpeed(4);
    const id = store.dev.crewShortage(24);
    store.modal = null;
    store.setSpeed(4);
    pushDecision(g, { kind: 'crewShort', title: 'Crew short', body: 'x', defaultOption: 'a', expires: g.now + 60, options: [{ id: 'a', label: 'A', desc: '' }], data: { flightId: id, paced: true } });
    autoPause('decision');
    expect(store.blocked).toBe(true);
    // Crew Control's cancel (or sub-charter) takes the leg off our hands.
    store.act((gg) => { gg.flights[id].status = 'cancelled'; return { ok: true }; }, { toastOk: false });
    expect(g.decisions).toEqual([]);
    expect(store.blocked).toBe(false);
    expect(store.paused).toBe(false);
    expect(store.speed).toBe(4);
  });
});

describe('v0.15 the hold goes through a save', () => {
  it('saved while held at 4×, loaded, answered: runs at 4×', () => {
    const g = start(4);
    const a = sample(g);
    autoPause('decision');
    expect(g.autoHold).toEqual({ speed: 4, items: [{ reason: 'decision', keys: [a.id] }] });
    const text = serialize(g);
    store.setSpeed(1);
    store.loadGame(deserialize(text));
    expect(store.paused).toBe(true);
    expect(store.speed).toBe(4);
    expect(store.pauseReason).toBe('decision');
    answer(a.id);
    expect(store.paused).toBe(false);
    expect(store.speed).toBe(4);
  });

  it('an older save waiting on a decision resumes at the default speed; a v0.15 save with nothing held stays paused', () => {
    const g = start(4);
    const a = sample(g);
    delete g.autoHold;
    store.setSpeed(4);
    store.loadGame(deserialize(serialize(g)));
    expect(store.hold).toEqual({ resume: DEFAULT_RESUME, items: [{ reason: 'decision', keys: [a.id] }] });
    answer(a.id);
    expect(store.paused).toBe(false);
    expect(store.speed).toBe(DEFAULT_RESUME);
    const g2 = store.game!;
    const b = sample(g2);
    g2.autoHold = null;
    store.loadGame(deserialize(serialize(g2)));
    expect(store.hold).toBeNull();
    answer(b.id);
    expect(store.paused).toBe(true);
  });

  it('a new game never inherits a hold', () => {
    start(4);
    expect(store.game!.autoHold).toBeNull();
  });
});

describe('v0.15 hold helpers (pure)', () => {
  const g = fixtureGame(5);
  it('pending reasons, merging, the top reason, the save round trip', () => {
    const d = sample(g);
    let h: Hold = { resume: 4, items: [] };
    h = addItem(h, { reason: 'decision', keys: [d.id] });
    h = addItem(h, { reason: 'decision', keys: ['gone'] });
    h = addItem(h, { reason: 'monthEnd', keys: [] });
    expect(h.items).toEqual([{ reason: 'decision', keys: [d.id, 'gone'] }, { reason: 'monthEnd', keys: [] }]);
    expect(topReason(h.items)).toBe('decision');
    expect(pendingItems(g, h).length).toBe(2);
    g.decisions = [];
    expect(pendingItems(g, h)).toEqual([{ reason: 'monthEnd', keys: [] }]);
    // A note joined by subjects stays a note.
    expect(addItem({ resume: 1, items: [{ reason: 'aog', keys: [] }] }, { reason: 'aog', keys: ['x'] }).items[0].keys).toEqual([]);
    expect(holdToSave(null)).toBeNull();
    expect(holdToSave({ resume: null, items: [] })).toEqual({ manual: true, items: [] });
  });

  it('loading: a bad or missing speed gets the default, unknown reasons are dropped, resolved ones too', () => {
    const x = fixtureGame(5);
    const d = sample(x);
    x.autoHold = { speed: 3, items: [{ reason: 'decision', keys: [d.id] }, { reason: 'nonsense', keys: ['a'] }] };
    expect(holdFromSave(x, true)).toEqual({ resume: DEFAULT_RESUME, items: [{ reason: 'decision', keys: [d.id] }] });
    x.autoHold = { manual: true, items: [{ reason: 'decision', keys: [d.id] }] };
    expect(holdFromSave(x, true)?.resume).toBeNull();
    x.autoHold = { speed: 2, items: [{ reason: 'decision', keys: ['gone'] }] };
    expect(holdFromSave(x, true)).toBeNull();
    // Older save: only when decisions hold the clock (Settings).
    delete x.autoHold;
    expect(holdFromSave(x, false)).toBeNull();
  });

  it('urgent offers: every open urgent one is a subject; a reason with nothing to point at has none (a note)', () => {
    const y = fixtureGame(5);
    const old = offer(y, 'aogCover', { start: y.now + 30 * 60 });
    old.urgency = 'urgent';
    old.created = y.now - 60;
    expect(subjectsOf(y, 'urgentOffer')).toContain(old.id);
    expect(subjectsOf(y, 'decision')).toEqual([]);
    expect(subjectsOf(y, 'monthEnd')).toEqual([]);
  });
});
