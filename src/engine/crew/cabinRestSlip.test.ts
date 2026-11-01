// v0.14.1 (merge) a duty whose cabin crew are only still resting at their own (earlier) report waits for them: the
// rest slip measured against the pilots' report, so a purser resting to 07:52 for an 08:00 report (cabin 07:15) was
// never 'held up only by rest' and came off the trip when nobody could replace her.

import { describe, expect, it } from 'vitest';
import { DAY } from '../core/time';
import { demoFlights, devAddType } from '../dev';
import { advanceTo } from '../sim';
import { fixtureGame } from './fixtures';
import { guardDuty } from './roster';
import { cabinEarly, touchCrew, touchCrewState } from './timeline';

describe('v0.14.1 rest slip for cabin crew', () => {
  it('a cabin crew member resting past her own report moves the duty, not off it', () => {
    const g = fixtureGame(5);
    // A widebody: its cabin crew report earlier than the pilots.
    const wide = devAddType(g, 'a333');
    demoFlights(g, undefined, 3, 'revenue');
    advanceTo(g, g.now + 60);
    const d = Object.values(g.duties).filter((x) => x.report > g.now + 4 * 60 && g.pairings[x.pairingId]?.aircraftId === wide && g.pairings[x.pairingId]?.slots.some((s) => s.crewId && s.role === 'CC')).sort((a, b) => a.report - b.report)[0];
    const p = g.pairings[d.pairingId];
    const early = cabinEarly(g, p, d);
    expect(early).toBeGreaterThan(10);
    const seat = p.slots.find((s) => s.crewId && s.role === 'CC')!;
    const cc = g.crew[seat.crewId!];
    // Placed by hand (the re-plan keeps her; the last check before the duty decides).
    seat.locked = true;
    // Nobody else can take a cabin seat.
    for (const c of Object.values(g.crew)) if ((c.role === 'CC' || c.role === 'PUR') && !p.slots.some((s) => s.crewId === c.id)) {
      c.status = 'sick';
      c.blocks = [...(c.blocks ?? []), { from: g.now - DAY, to: g.now + 30 * DAY, why: 'sick' }];
    }
    // Resting until 5 min before the pilots' report: inside her own, earlier one.
    cc.restUntil = d.report - 5;
    touchCrew(g);
    touchCrewState(g);
    const f = g.flights[d.flightIds[0]];
    const std = f.std;
    guardDuty(g, d.id);
    expect(p.slots.some((s) => s.crewId === cc.id)).toBe(true);
    expect(g.flights[f.id].std).toBeGreaterThanOrEqual(std + early - 5);
    expect(g.flights[f.id].std).toBeLessThanOrEqual(std + early + 5);
  });
});
