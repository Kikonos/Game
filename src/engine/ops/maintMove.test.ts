// v0.7.2.2 Check planning: drag a booked A-check, C-check or cabin refit along its aircraft's timeline (checkMaintMove /
// quoteMaintMove / moveMaint), and book from an idle gap (gapCheck).

import { describe, expect, it } from 'vitest';
import { flightsOf } from '../core/entities';
import { typeOf } from '../core/perf';
import { DAY, HOUR } from '../core/time';
import type { Flight, GameState } from '../core/types';
import { acceptOffer, relinkPositioning } from '../contracts';
import { legsOffer, leased, newGame, owned, run } from '../contracts/testkit';
import { deserialize, serialize } from '../save';
import { settle } from '../sim';
import { bookRefit, cabinOptions } from './cabin';
import { bookCCheck } from './cHub';
import { checkMaintMove, gapCheck, moveMaint, movableMaint, quoteMaintMove } from './maintMove';
import { scheduleCheck } from './maintenance';

const live = (g: GameState, acId: string) => flightsOf(g, acId).filter((f) => f.status === 'scheduled');
const empties = (g: GameState, acId: string) => live(g, acId).filter((f) => f.kind === 'positioning' || f.kind === 'ferry');
const sig = (f: Pick<Flight, 'from' | 'to' | 'std'>) => `${f.from}-${f.to}@${f.std}`;
const state = (g: GameState) => JSON.stringify((JSON.parse(serialize(g)) as { state: unknown }).state);

function charter(g: GameState, acId: string, legs: [string, string, number][]): Flight[] {
  const r = acceptOffer(g, legsOffer(g, legs, 150).id, [acId]);
  if (!r.ok) throw new Error(r.error);
  settle(g);
  return live(g, acId).filter((f) => f.contractId === r.data!.contractId && f.kind === 'revenue');
}

/** Moves it and checks the quote's empty legs are exactly what changed; a relink afterwards changes nothing. */
function moveAndAgree(g: GameState, maintId: string, start: number) {
  const acId = g.maintenance[maintId].aircraftId;
  const q = quoteMaintMove(g, maintId, start);
  expect(q.ok, q.reason ?? '').toBe(true);
  const was = empties(g, acId).map(sig);
  const r = moveMaint(g, maintId, start);
  if (!r.ok) throw new Error(r.error);
  settle(g);
  const now = empties(g, acId).map(sig);
  expect(q.legs.filter((l) => l.added).map(sig).sort()).toEqual(now.filter((s) => !was.includes(s)).sort());
  expect(q.legs.filter((l) => !l.added).map(sig).sort()).toEqual(was.filter((s) => !now.includes(s)).sort());
  relinkPositioning(g, acId);
  expect(empties(g, acId).map(sig)).toEqual(now);
  return { q, m: g.maintenance[r.data!.maintId] };
}

function aCheck(g: GameState, acId: string, start: number, at = 'LIS') {
  const r = scheduleCheck(g, acId, 'A', start, at);
  if (!r.ok) throw new Error(r.error);
  settle(g);
  return g.maintenance[r.data!.maintId];
}

describe('checkMaintMove (the live drag)', () => {
  it('shows the usage then and refuses flights in the way, too soon, and over 100%', () => {
    const g = newGame(3);
    const a = owned(g);
    const d = g.now + 4 * DAY;
    charter(g, a.id, [['LIS', 'DUS', d + 8 * HOUR], ['DUS', 'LIS', d + 13 * HOUR]]);
    const m = aCheck(g, a.id, d - DAY + 22 * HOUR);
    const later = checkMaintMove(g, m.id, d + DAY + 22 * HOUR + 10);
    expect(later.ok).toBe(true);
    expect(later.start % 30).toBe(0);
    expect(later.usageText).toMatch(/^A-check at \d+% used$/);
    expect(later.level).toBe('good');
    const over = checkMaintMove(g, m.id, d + 7 * HOUR);
    expect(over.ok).toBe(false);
    expect(over.reason).toMatch(new RegExp(`^${a.reg} is flying LIS–DUS \\d+ \\w+ \\d\\d:\\d\\d then$`));
    expect(checkMaintMove(g, m.id, g.now + 10).reason).toMatch(/^Too soon/);
    // Over the interval by then: red, not allowed.
    a.maint.fhSinceA = typeOf(a.typeId).aCheckFH - 1;
    const late = checkMaintMove(g, m.id, d + 20 * DAY);
    expect(late.ok).toBe(false);
    expect(late.level).toBe('bad');
    expect(late.reason).toMatch(/^Overdue by then \(\d+% used\): not allowed$/);
  });

  it('a check in work, client paint and an AOG don’t move', () => {
    const g = newGame(3);
    const a = owned(g);
    const m = aCheck(g, a.id, g.now + 2 * DAY);
    expect(movableMaint(g, m.id).ok).toBe(true);
    m.status = 'inWork';
    expect(movableMaint(g, m.id).reason).toBe('The A-check is in work: it can’t move now');
    m.status = 'planned';
    m.kind = 'paint';
    expect(movableMaint(g, m.id).ok).toBe(false);
  });
});

describe('moveMaint', () => {
  it('an A-check moves later at the same airport and price; the quote leaves the game alone', () => {
    const g = newGame(3);
    const a = owned(g);
    const m = aCheck(g, a.id, g.now + 3 * DAY + 22 * HOUR);
    const before = state(g);
    const q = quoteMaintMove(g, m.id, m.start + 2 * DAY);
    expect(state(g)).toBe(before);
    expect(q.ok).toBe(true);
    expect(q.notes[0]).toBe(`${a.reg} is already at LIS then: no ferry needed.`);
    const { m: n } = moveAndAgree(g, m.id, m.start + 2 * DAY);
    expect(g.maintenance[m.id].status).toBe('cancelled');
    expect(n).toMatchObject({ kind: 'A', at: 'LIS', status: 'planned', start: m.start + 2 * DAY, end: m.end + 2 * DAY, cost: m.cost });
    expect(Object.values(g.maintenance).filter((x) => x.aircraftId === a.id && x.status === 'planned').length).toBe(1);
    expect(g.messages.some((x) => x.title === `A-check moved: ${a.reg}`)).toBe(true);
    // It plays on: the check happens at the new time.
    run(g, n.start + 60);
    expect(g.maintenance[n.id].status).toBe('inWork');
  }, 60_000);

  it('a hub C-check moves with its ferries: the old ones go, new ones fly out and home, no orphans', () => {
    const g = newGame(3);
    const a = owned(g);
    const r = bookCCheck(g, a.id, 'SOF', g.now + 5 * DAY);
    if (!r.ok) throw new Error(r.error);
    settle(g);
    const m = g.maintenance[r.data!.maintId];
    const old = [...(m.ferryIds ?? []), ...(m.homeIds ?? [])];
    expect(old.length).toBeGreaterThanOrEqual(2);
    const { q, m: n } = moveAndAgree(g, m.id, m.start + 7 * DAY);
    expect(q.usageText).toMatch(/^C-check: \d+% of interval used by then$/);
    expect(q.notes[0]).toMatch(new RegExp(`^${a.reg} must be at SOF by then: ferry LIS–SOF`));
    for (const id of old) expect(g.flights[id]).toBeUndefined();
    expect(n.hub?.code).toBe('SOF');
    expect(n.cost).toBe(m.cost);
    const fo = n.ferryIds!.map((id) => g.flights[id]);
    const fh = n.homeIds!.map((id) => g.flights[id]);
    expect(fo[fo.length - 1].to).toBe('SOF');
    expect(fo[fo.length - 1].sta).toBeLessThanOrEqual(n.start);
    expect(fh[0].from).toBe('SOF');
    expect(fh[0].std).toBeGreaterThanOrEqual(n.end);
    expect(empties(g, a.id).length).toBe(fo.length + fh.length);
  }, 60_000);

  it('a cabin refit moves at the same price and layout; the way home from a trip before it is planned, nothing left behind', () => {
    const g = newGame(3);
    const a = owned(g);
    const label = cabinOptions(a.typeId).find((p) => p.label !== a.cabin.label)!.label;
    const d = g.now + 10 * DAY;
    const r = bookRefit(g, a.id, label, 'LIS', d);
    if (!r.ok) throw new Error(r.error);
    settle(g);
    const m = g.maintenance[r.data!.maintId];
    // A one-way trip to DUS the day before the new slot: the empty leg home lands before the refit.
    charter(g, a.id, [['LIS', 'DUS', d + 9 * DAY + 8 * HOUR]]);
    const target = d + 10 * DAY;
    const c = checkMaintMove(g, m.id, target);
    expect(c.ok, c.reason ?? '').toBe(true);
    expect(c.usageText).toBe(`Out of service ${Math.round((m.end - m.start) / DAY)} days`);
    expect(c.ferryFrom).toBeNull();
    const { q, m: n } = moveAndAgree(g, m.id, target);
    expect(q.notes[0]).toBe(`${a.reg} is already at LIS then: no ferry needed.`);
    const home = live(g, a.id).filter((f) => f.from === 'DUS' && f.to === 'LIS');
    expect(home.length).toBe(1);
    expect(home[0].sta).toBeLessThanOrEqual(target);
    expect(n).toMatchObject({ kind: 'refit', at: 'LIS', cost: m.cost, start: target, end: target + (m.end - m.start) });
    expect(n.refit?.cabin.label).toBe(label);
    // Moving it back again: still one way home after the trip, no other empty legs.
    const back = moveAndAgree(g, n.id, d);
    expect(live(g, a.id).filter((f) => f.kind === 'positioning' || f.kind === 'ferry').map((f) => `${f.from}-${f.to}`)).toEqual(['DUS-LIS']);
    expect(back.m.ferryIds ?? []).toEqual([]);
    expect(g.finance.current.lines.refit ?? 0).toBe(0);
  }, 60_000);

  it('a saved game after a move plays on identically', () => {
    const g = newGame(5);
    const a = owned(g);
    const m = aCheck(g, a.id, g.now + 3 * DAY + 22 * HOUR);
    expect(moveMaint(g, m.id, m.start + DAY).ok).toBe(true);
    settle(g);
    const h = deserialize(serialize(g));
    run(g, g.now + 6 * DAY);
    run(h, g.now);
    expect(state(h)).toBe(state(g));
  }, 60_000);
});

describe('gapCheck (book from an idle gap)', () => {
  it('A-check: in the gap at home, the usage then and the due date; too short is refused', () => {
    const g = newGame(3);
    const a = owned(g);
    const from = g.now + 2 * DAY;
    const ok = gapCheck(g, a.id, 'A', from, from + DAY, 'LIS');
    expect(ok.ok).toBe(true);
    expect(ok.start! >= from && ok.start! < from + DAY).toBe(true);
    expect(ok.at).toBe('LIS');
    expect(ok.text).toMatch(/^A-check \d+% used then · next due \d+ \w+$/);
    const short = gapCheck(g, a.id, 'A', from, from + 6 * HOUR, 'LIS');
    expect(short.ok).toBe(false);
    expect(short.why).toBe(`The gap is too short for an A-check (${typeOf(a.typeId).aCheckHours} h)`);
  });

  it('C-check: a hub window inside a long gap; a few days are too short', () => {
    const g = newGame(3);
    const b = leased(g);
    const from = g.now + 3 * DAY;
    const ok = gapCheck(g, b.id, 'C', from, from + 30 * DAY, 'LIS');
    expect(ok.ok, ok.why ?? '').toBe(true);
    expect(['SOF', 'MLA']).toContain(ok.hub);
    expect(ok.start! > from && ok.start! < from + 30 * DAY).toBe(true);
    const short = gapCheck(g, b.id, 'C', from, from + 5 * DAY, 'LIS');
    expect(short.ok).toBe(false);
    expect(short.why).toMatch(/^The gap is too short for a C-check \(\d+ days plus the ferries\)/);
  });
});
