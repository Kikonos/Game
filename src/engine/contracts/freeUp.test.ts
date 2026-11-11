// v0.20.1 report bmwbb036sdk6l (Blue Airlines, 18 Jan 2029, "Guiana rotation via Pointe-à-Pitre"): "I subleased a trip
// from this aircraft at great cost to try to fit this contract in and even after that, it's not possible, the sublease
// options are misleading". CS-TTD flew Overflow: Edelweiss Air at Zurich (31 Jan–25 Feb); its flights existed up to
// 15 Feb, the job starts 14 Feb. The dialog said "Flights in the way · Solvable" and offered to sub-lease the two
// Zurich–New York trips; with them gone the programme's later days (no flights yet) still booked the aircraft.

import { describe, expect, it } from 'vitest';
import { feasibility, feasibilityAll } from '.';
import { touchFlights } from '../core/entities';
import type { GameState } from '../core/types';
import { fixture } from '../fixtures/compatKit';
import { subcharter } from '../ops';
import { subleaseTrip } from '../ops/sublease';
import { deserialize } from '../save';
import '../sim';
import { blockTier, offerVerdict, reportRank, topBlocker } from './blockers';
import { freeUpVerdict, freeUpWarning } from './freeUp';

const GUIANA = 'o3z0k';
const COPENHAGEN = 'o400d';
const save = () => deserialize(fixture('v020-guiana'));
const ac = (g: GameState, reg: string) => Object.values(g.fleet).find((a) => a.reg === reg)!;
const report = (g: GameState, offerId: string, reg: string) => feasibility(g, offerId, ac(g, reg).id);

/** The save a few minutes earlier: the two Zurich–New York trips the player handed over are back on CS-TTD. */
function before(): GameState {
  const g = save();
  const ttd = ac(g, 'CS-TTD');
  for (const f of Object.values(g.flights)) {
    if (f.operatedBy && f.contractId === 'k3yte' && f.std > g.now) {
      f.aircraftId = ttd.id;
      delete f.operatedBy;
    }
  }
  touchFlights(g);
  return g;
}

describe('v0.20.1 sub-lease advice only when it makes room (bmwbb036sdk6l)', () => {
  it('before the hand-over: CS-TTD is booked for other work, not "flights in the way"', () => {
    const g = before();
    const r = report(g, GUIANA, 'CS-TTD');
    expect(r.conflicts.flights.length).toBe(4);
    expect(r.conflicts.programmes).toEqual(['k3yte']);
    // The programme's days without flights are in the way too: nothing the player can move or hand over frees them.
    expect(reportRank(r)).toBe(1);
    expect(blockTier(topBlocker(r)!, r)).toBe(1);
    const v = offerVerdict(g, feasibilityAll(g, GUIANA), r.aircraftId)!;
    expect(v.rank).toBe(1);
    expect(v.headline).toMatch(/^Booked for other work on CS-TTD: Overflow: Edelweiss Air at Zurich/);
  });

  it('says before anything is paid that handing the trips over will not make room, and what still blocks', () => {
    const g = before();
    const r = report(g, GUIANA, 'CS-TTD');
    const fv = freeUpVerdict(g, GUIANA, r.aircraftId, r.conflicts.flights);
    expect(fv.fits).toBe(false);
    expect(fv.still).toBe('still busy with Overflow: Edelweiss Air at Zurich (31 Jan–25 Feb)');
    expect(freeUpWarning(fv)).toBe("Sub-leasing these trips won't make room for this job on its own: still busy with Overflow: Edelweiss Air at Zurich (31 Jan–25 Feb).");
    // The game state is untouched (the verdict works on a copy).
    expect(r.conflicts.flights.every((id) => g.flights[id].status === 'scheduled' && g.flights[id].aircraftId === r.aircraftId)).toBe(true);
    expect(report(g, GUIANA, 'CS-TTD').conflicts.flights.length).toBe(4);
  });

  it('the verdict is what really happens: the trips sub-leased, the job still does not fit', () => {
    const g = before();
    const r = report(g, GUIANA, 'CS-TTD');
    const said = freeUpVerdict(g, GUIANA, r.aircraftId, r.conflicts.flights);
    const cash = g.company.cash;
    for (const id of r.conflicts.flights) {
      if (g.flights[id]?.operatedBy) continue;
      const sub = subleaseTrip(g, id);
      expect(sub.ok).toBe(true);
      expect(subcharter(g, sub.flightIds, sub.best!.cost, sub.best!.rivalId).ok).toBe(true);
    }
    expect(g.company.cash).toBeLessThan(cash);
    const after = report(g, GUIANA, 'CS-TTD');
    expect(after.level).toBe('no');
    expect(after.conflicts.flights).toEqual([]);
    expect(topBlocker(after)!.label).toBe(topBlocker(said.report)!.label);
  });

  it('other aircraft: an approval or a lease that stays in the way is named', () => {
    const g = save();
    const ttl = report(g, GUIANA, 'CS-TTL');
    expect(ttl.conflicts.flights.length).toBeGreaterThan(0);
    expect(freeUpVerdict(g, GUIANA, ttl.aircraftId, ttl.conflicts.flights).still).toBe('routing needs ETOPS 180: we hold ETOPS 120');
    const tpm = report(g, GUIANA, 'CS-TPM');
    expect(reportRank(tpm)).toBe(1);
    expect(freeUpVerdict(g, GUIANA, tpm.aircraftId, tpm.conflicts.flights).still).toMatch(/^still busy with Capacity lease: one widebody/);
  });

  it('a trip whose hand-over leaves the aircraft unable to be back for its next flight is not proposed', () => {
    const g = save();
    const r = report(g, COPENHAGEN, 'CS-TVP');
    expect(reportRank(r)).toBe(2);
    const fv = freeUpVerdict(g, COPENHAGEN, r.aircraftId, r.conflicts.flights);
    expect(fv.fits).toBe(false);
    expect(fv.still).toMatch(/^can't be back for Capacity lease/);
  });

  it('a hand-over that does make room is proposed, and it does: the job fits once the trip is sub-leased', () => {
    const g = save();
    const r = report(g, COPENHAGEN, 'CS-TTD');
    expect(reportRank(r)).toBe(2);
    expect(r.conflicts.programmes).toEqual([]);
    const sub = subleaseTrip(g, r.conflicts.flights[0]);
    expect(sub.ok).toBe(true);
    const fv = freeUpVerdict(g, COPENHAGEN, r.aircraftId, [...new Set([...r.conflicts.flights, ...sub.flightIds])]);
    expect(fv).toMatchObject({ fits: true, still: null });
    expect(subcharter(g, sub.flightIds, sub.best!.cost, sub.best!.rivalId).ok).toBe(true);
    const after = report(g, COPENHAGEN, 'CS-TTD');
    expect(after.level).not.toBe('no');
    expect(after.checks.map((c) => `${c.level}:${c.label}`)).toEqual(fv.report.checks.map((c) => `${c.level}:${c.label}`));
  });
});
