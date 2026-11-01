// v0.12.1 (Round F merge, seed 6): a tour that grows as its base programme's days are generated gave its crew new
// duties on days where the day plan had put them on hotel standby; the standby stayed, uncalled, around the duty (a
// whole crew at Riyadh, 00:00-12:00 standby with a 01:00 report). The new days now take the standby away.

import { describe, expect, it } from 'vitest';
import { acceptOffer } from '../contracts';
import { leased, newGame, offer, run } from '../contracts/testkit';
import { DAY } from '../core/time';
import { planAircraft } from './duties';
import { touchCrew } from './timeline';

describe('a tour growing into a planned standby', () => {
  it('the standby on the new day gives way to the duty', () => {
    const g = newGame(21);
    const ac = leased(g);
    const o = offer(g, 'seasonBase', { airport: 'DUB', dests: ['LIS'], waves: 2, start: g.now + 3 * DAY, days: 60 });
    o.broker = undefined;
    const r = acceptOffer(g, o.id, [ac.id]);
    if (!r.ok) throw new Error(r.error);
    const k = g.contracts[r.data!.contractId];
    run(g, k.start + 10 * DAY);
    // A crewed tour's last day, taken off it as if not generated yet (its flights without a duty).
    // v0.14 (the offer stream moved: reply windows) the first such tour whose last day is still more than a day away.
    const p = Object.values(g.pairings).filter((q) => q.tour && q.status !== 'done' && q.slots.some((s) => s.crewId) && q.dutyIds.length > 2 && (g.duties[q.dutyIds[q.dutyIds.length - 1]]?.report ?? 0) > g.now + DAY).sort((a, b) => a.start - b.start)[0];
    expect(p).toBeTruthy();
    const d = g.duties[p.dutyIds[p.dutyIds.length - 1]];
    expect(d.report).toBeGreaterThan(g.now + DAY);
    p.dutyIds = p.dutyIds.filter((id) => id !== d.id);
    for (const id of d.flightIds) g.flights[id].dutyId = null;
    delete g.duties[d.id];
    // Every tour crew on hotel standby at Dublin that day.
    const tours = Object.values(g.pairings).filter((q) => q.tour && q.status !== 'done' && q.slots.some((x) => x.crewId));
    for (const id of new Set(tours.flatMap((q) => q.slots.map((x) => x.crewId).filter((x): x is string => !!x)))) {
      g.crew[id].standby = [...(g.crew[id].standby ?? []).filter((w) => w.to <= d.report - DAY || w.from >= d.release + DAY), { from: d.report - 60, to: d.report + 11 * 60, kind: 'hotel', at: 'DUB' }];
    }
    touchCrew(g);
    // The day comes back to a crewed tour: its crew are no longer on standby around it.
    planAircraft(g, ac.id, g.now);
    const nd = g.duties[g.flights[d.flightIds[0]].dutyId ?? ''];
    const q = g.pairings[nd?.pairingId ?? ''];
    expect(q?.tour && nd.report === d.report).toBeTruthy();
    const crew = q.slots.map((x) => x.crewId).filter((x): x is string => !!x);
    expect(crew.length).toBeGreaterThan(0);
    for (const id of crew) {
      const w = (g.crew[id].standby ?? []).find((x) => x.from <= d.report && x.to > d.report);
      expect(w === undefined || w.calledAt !== undefined).toBe(true);
    }
  });
});
