// v0.7.2.2 player bug: "I dragged and dropped this MAN-FUE from CS-THF to CS-TWJ but the ferry still remained in
// CS-THF". The empty legs that only flew the old aircraft out to a moved trip and back are removed (the relink kept any
// continuous chain, even LIS–MAN–LIS around nothing); a check's ferry is re-planned from where the aircraft really is;
// the quote's 'No longer needed' list is exactly what the move removes.

import LZString from 'lz-string';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { flightsOf } from '../core/entities';
import { DAY } from '../core/time';
import type { Flight, GameState } from '../core/types';
import { acceptOffer, relinkPositioning } from '../contracts';
import { legsOffer, leased, newGame, owned, run } from '../contracts/testkit';
import { deserialize } from '../save';
import { advanceTo, settle } from '../sim';
import { bookCCheck } from './cHub';
import { moveTrip, quoteTripMove } from './tripMove';

const live = (g: GameState, acId: string) => flightsOf(g, acId).filter((f) => f.status === 'scheduled');
const empties = (g: GameState, acId: string) => live(g, acId).filter((f) => f.kind === 'positioning' || f.kind === 'ferry');
const sig = (f: Flight) => `${f.from}-${f.to}@${f.std}`;

function charter(g: GameState, acId: string, legs: [string, string, number][]): Flight[] {
  const r = acceptOffer(g, legsOffer(g, legs, 150).id, [acId]);
  if (!r.ok) throw new Error(r.error);
  settle(g);
  return live(g, acId).filter((f) => f.contractId === r.data!.contractId && f.kind === 'revenue');
}

/** The airports an aircraft's scheduled legs call at, in order (empty legs included). */
const calls = (g: GameState, acId: string, from = -Infinity, to = Infinity) => live(g, acId).filter((f) => f.std >= from && f.std < to).map((f) => `${f.from}-${f.to}`);

/** Moves the trip and checks the quote's empty legs (added / no longer needed) are exactly what the move did. */
function moveAndAgree(g: GameState, flightId: string, targetId: string) {
  const q = quoteTripMove(g, flightId, targetId);
  expect(q.ok, q.reasons.join('; ')).toBe(true);
  const two = [q.sourceId, targetId];
  const before = new Map(two.map((id) => [id, empties(g, id).map(sig)]));
  const r = moveTrip(g, flightId, targetId, q.net);
  expect(r.ok).toBe(true);
  for (const id of two) {
    const now = empties(g, id).map(sig);
    const was = before.get(id)!;
    const gone = was.filter((s) => !now.includes(s)).sort();
    const added = now.filter((s) => !was.includes(s)).sort();
    expect(q.positioning.filter((p) => p.aircraftId === id && !p.added).map((p) => `${p.from}-${p.to}@${p.std}`).sort()).toEqual(gone);
    expect(q.positioning.filter((p) => p.aircraftId === id && p.added).map((p) => `${p.from}-${p.to}@${p.std}`).sort()).toEqual(added);
  }
  // Every empty leg removed costs nothing any more: the quote's 'before' carries it, the notes name it.
  const gone = q.positioning.filter((p) => !p.added);
  if (gone.length) {
    expect(q.before.ferry).toBeLessThan(0);
    expect(q.notes.some((n) => n.startsWith('No longer needed:'))).toBe(true);
  }
  return q;
}

/** A relink pass changes nothing (the empty legs are a fixed point: nothing left to clean up). */
function settled(g: GameState, acId: string) {
  const s = empties(g, acId).map(sig);
  relinkPositioning(g, acId);
  expect(empties(g, acId).map(sig)).toEqual(s);
}

const playerSave = () => LZString.decompressFromBase64(readFileSync(new URL('../fixtures/save-v0721-trip.lz.txt', import.meta.url), 'utf8'))!;

describe('v0.7.2.2 the player’s save (Astor Airlines, 23 Sep 2027)', () => {
  it('the two orphan legs LIS–MAN / MAN–LIS on CS-THF go at the next re-plan; nothing else changes; the C-check stays', () => {
    const g = deserialize(playerSave());
    // Loading alone deletes nothing.
    expect(g.flights.f7t2?.status).toBe('scheduled');
    expect(g.flights.f7t4?.status).toBe('scheduled');
    const ids = Object.keys(g.flights).filter((id) => g.flights[id].kind !== 'deadhead');
    const c = { ...g.maintenance.mxitg };
    advanceTo(g, g.now + 5);
    // v0.12.1 and the DUS–TMS ferry (fn20/fn22, by Abuja) re-plans by its new fuel stop, Algiers: same aircraft, same ends.
    expect(ids.filter((id) => !g.flights[id])).toEqual(['f7t2', 'f7t4', 'fn20', 'fn22']);
    const added = Object.keys(g.flights).filter((id) => g.flights[id].kind !== 'deadhead' && !ids.includes(id)).map((id) => g.flights[id]);
    expect(added.map((f) => `${f.from}-${f.to} ${f.aircraftId} ${f.kind}`)).toEqual(['DUS-ALG a5kf positioning', 'ALG-TMS a5kf positioning']);
    // CS-THF lands at LIS on 14 Oct and waits there for its C-check at LIS (19 Oct): no flying in between.
    const thf = g.fleet.a1;
    expect(calls(g, thf.id, g.flights.fn02.sta, c.end)).toEqual([]);
    expect(g.maintenance.mxitg).toMatchObject({ status: 'planned', at: 'LIS', start: c.start, end: c.end });
    expect(g.maintenance.mxitg.ferryIds ?? []).toEqual([]);
    settled(g, thf.id);
  }, 60_000);

  it('moving MAN–FUE–MAN back to CS-THF and then to CS-TWJ again leaves no ferry behind on either', () => {
    const g = deserialize(playerSave());
    advanceTo(g, g.now + 5);
    const [thf, twj] = [g.fleet.a1, g.fleet.a2];
    const day = (t: number) => [t - 3 * DAY, t + 3 * DAY] as const;
    const [s, e] = day(g.flights.f7sm.std);
    const man = (acId: string) => live(g, acId).filter((f) => f.std >= s && f.std < e && (f.from === 'MAN' || f.to === 'MAN'));
    moveAndAgree(g, 'f7sm', thf.id);
    settle(g);
    expect(man(thf.id).map((f) => `${f.from}-${f.to}`)).toEqual(['LIS-MAN', 'MAN-FUE', 'FUE-MAN', 'MAN-LIS']);
    expect(man(twj.id)).toEqual([]);
    settled(g, twj.id);
    moveAndAgree(g, 'f7sm', twj.id);
    settle(g);
    expect(man(thf.id)).toEqual([]);
    expect(calls(g, thf.id, g.flights.fn02.sta, g.maintenance.mxitg.end)).toEqual([]);
    expect(man(twj.id).map((f) => `${f.from}-${f.to}`)).toEqual(['AMS-MAN', 'MAN-FUE', 'FUE-MAN', 'MAN-AMS']);
    settled(g, thf.id);
    // It plays on cleanly past the trip (a client may still move it by a day).
    for (let i = 0; i < 3 && g.flights.f7so.status !== 'done'; i++) run(g, g.flights.f7so.sta + DAY);
    expect(g.flights.f7so.status).toBe('done');
    expect(g.flights.f7so.aircraftId).toBe(twj.id);
  }, 120_000);
});

describe('v0.7.2.2 moving a trip removes the old aircraft’s ferries for it', () => {
  /**
   * LAD–ACC–LAD on the owned A320: the way out and back is LIS–NIM–LAD and LAD–NIM–LIS (a fuel stop at Niamey; v0.12.1
   * the stop midway, before: Libreville near the end).
   */
  function lad(later: boolean) {
    const g = newGame(3);
    const a = owned(g);
    const b = leased(g);
    const d = g.now + 5 * DAY;
    const legs = charter(g, a.id, [['LAD', 'ACC', d + 8 * 60], ['ACC', 'LAD', d + 13 * 60]]);
    if (later) charter(g, a.id, [['LIS', 'DUS', d + 4 * DAY], ['DUS', 'LIS', d + 4 * DAY + 5 * 60]]);
    return { g, a, b, legs };
  }
  const away = (g: GameState, acId: string) => live(g, acId).filter((f) => ['NIM', 'LAD', 'ACC'].includes(f.from) || ['NIM', 'LAD', 'ACC'].includes(f.to));

  for (const later of [true, false]) {
    it(`ferries before and after, with a fuel stop, ${later ? 'with more work after' : 'at the end of the schedule'}; and back again`, () => {
      const { g, a, b, legs } = lad(later);
      expect(away(g, a.id).map((f) => `${f.from}-${f.to}`)).toEqual(['LIS-NIM', 'NIM-LAD', 'LAD-ACC', 'ACC-LAD', 'LAD-NIM', 'NIM-LIS']);
      // The contract planned its positioning (contractId set).
      expect(away(g, a.id).filter((f) => f.kind === 'positioning').every((f) => f.contractId === legs[0].contractId)).toBe(true);
      const q = moveAndAgree(g, legs[0].id, b.id);
      expect(q.positioning.filter((p) => !p.added && p.aircraftId === a.id).length).toBe(4);
      settle(g);
      expect(away(g, a.id)).toEqual([]);
      expect(away(g, b.id).map((f) => `${f.from}-${f.to}`)).toEqual(['LIS-NIM', 'NIM-LAD', 'LAD-ACC', 'ACC-LAD', 'LAD-NIM', 'NIM-LIS']);
      settled(g, a.id);
      // Back to the first aircraft: the second one's ferries (planned by the move: no contract) go too.
      expect(away(g, b.id).filter((f) => f.kind === 'positioning').some((f) => f.contractId === null)).toBe(true);
      moveAndAgree(g, legs[0].id, a.id);
      settle(g);
      expect(away(g, b.id)).toEqual([]);
      expect(away(g, a.id).map((f) => `${f.from}-${f.to}`)).toEqual(['LIS-NIM', 'NIM-LAD', 'LAD-ACC', 'ACC-LAD', 'LAD-NIM', 'NIM-LIS']);
      settled(g, b.id);
    }, 60_000);
  }

  it('crew and airline tickets of the removed ferries are released (no duty or ticket left for a leg that is gone)', () => {
    const { g, a, b, legs } = lad(true);
    advanceTo(g, g.now + 60);
    const ferries = away(g, a.id).filter((f) => f.kind === 'positioning');
    const duties = new Set(ferries.map((f) => f.dutyId).filter((x): x is string => !!x));
    expect(duties.size).toBeGreaterThan(0);
    const tickets = [...duties].flatMap((id) => g.duties[id]?.deadheadIds ?? []);
    moveAndAgree(g, legs[0].id, b.id);
    settle(g);
    for (const f of ferries) expect(g.flights[f.id]?.status === 'scheduled' && g.flights[f.id]?.aircraftId === a.id).toBe(false);
    // No duty still flies a removed leg; every ticket left is still used by a live duty.
    for (const d of Object.values(g.duties)) for (const id of d.flightIds) expect(g.flights[id], `duty ${d.id} flies a removed leg`).toBeDefined();
    const used = new Set(Object.values(g.duties).filter((d) => !d.done).flatMap((d) => d.deadheadIds));
    for (const id of tickets) {
      const t = g.flights[id];
      if (t && t.status === 'scheduled') expect(used.has(id) || t.crewIds.length === 0).toBe(true);
    }
  }, 60_000);

  it('a C-check ferry that left from the trip’s end station is re-planned from where the aircraft really is', () => {
    const g = newGame(3);
    const a = owned(g);
    const b = leased(g);
    const d = g.now + 6 * DAY;
    const legs = charter(g, a.id, [['MAN', 'FUE', d + 5 * 60], ['FUE', 'MAN', d + 10 * 60]]);
    // C-check at Sofia two days after the trip: the ferry flies MAN–SOF straight after it.
    const r = bookCCheck(g, a.id, 'SOF', d + 2 * DAY);
    if (!r.ok) throw new Error(r.error);
    settle(g);
    const m = g.maintenance[r.data!.maintId];
    expect(m.ferryIds!.map((id) => `${g.flights[id].from}-${g.flights[id].to}`)).toEqual(['MAN-SOF']);
    expect(live(g, a.id).some((f) => f.from === 'MAN' && f.to === 'LIS')).toBe(false);
    moveAndAgree(g, legs[0].id, b.id);
    settle(g);
    // The aircraft never goes to MAN now: home at LIS, then straight to Sofia for the check, purpose kept.
    expect(live(g, a.id).filter((f) => f.from === 'MAN' || f.to === 'MAN')).toEqual([]);
    const fo = m.ferryIds!.map((id) => g.flights[id]);
    expect(fo.map((f) => `${f.from}-${f.to}`)).toEqual(['LIS-SOF']);
    expect(fo.every((f) => f.status === 'scheduled' && f.kind === 'ferry' && f.purpose === 'check' && f.sta <= m.start)).toBe(true);
    expect(m.status).toBe('planned');
    settled(g, a.id);
    // It plays on: the ferry flies and the check starts at Sofia.
    run(g, m.start + 60);
    expect(g.maintenance[m.id].status).toBe('inWork');
  }, 60_000);
});
