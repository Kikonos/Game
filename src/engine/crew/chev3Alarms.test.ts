// Crew alarm round (Nov 2026): the player's Chevron export (79 reports) held five crew alarms the self-check withheld
// ("every limit it names is clear when checked on its own"). Each snapshot is the game at the alarm's minute. The planner
// raised them for four reasons, each fixed at the root:
//   A. XY3060 17 Jul (Rui Ribeiro, PUR) "busy on another tour": he flew out to Riyadh the day before, worked a guest duty of
//      the same tour on the way, then this one. otherTrip clashed the other trip's duty with the whole span from the
//      ticket out to the last duty, not with his own work. (U27060 16 Dec: three cabin crew, the same pattern.)
//   B. FR2040 20 Oct (Beatriz Ribeiro) "busy on another tour until 14 Oct": a held seat re-checked with the planner's
//      own seating holds (two rotations at once), which are choices, not limits.
//   C. EW6000 19 Oct (Beatriz Ribeiro) "short of rest": the rest before her LATER trip's ticket was read as this duty's.
//   D. CVE291 29 Dec (Léa Bernard) "short of rest": 12 h at home before a ticket out (no FDP starts at home base).

import { describe, expect, it } from 'vitest';
import type { GameState } from '../core/types';
import { fixture } from '../fixtures/compatKit';
import { deserialize } from '../save';
import { crewIssuesFor, planCrew } from './check';
import { ALARM_HOOKS } from './control';
import { flightCrewStatus } from './roster';
import { evalSegs, minRest, type Seg, type TimelineCtx } from './rules';
import { checkAlarm } from './selfCheck';
import { segsOf } from './timeline';

/** The snapshot as it was (this version's once-on-load repairs off, as scripts/crewcheck.ts reads it). */
function asItWas(name: string): GameState {
  const data = JSON.parse(fixture(name)) as { state: GameState };
  data.state.stats.sideTripRedo = true;
  data.state.stats.perCrewRedo = true;
  data.state.stats.planRefund ??= 0;
  return deserialize(JSON.stringify(data));
}
const flightOf = (g: GameState, no: string) => Object.values(g.flights).filter((f) => f.no === no && f.status === 'scheduled').sort((a, b) => a.std - b.std)[0];
const crewOf = (g: GameState, name: string) => Object.values(g.crew).find((c) => `${c.first} ${c.last}` === name)!;

function expectClear(g: GameState, no: string): void {
  const f = flightOf(g, no);
  const d = g.duties[f.dutyId!];
  expect(crewIssuesFor(g, d)).toEqual([]);
  expect(flightCrewStatus(g, f.id, { live: false }).level).not.toMatch(/missing|illegal/);
}

describe('the player\'s withheld crew alarms (chev3 export)', () => {
  it('A: a guest duty between the ticket out and the first duty is no clash (XY3060, Rui Ribeiro)', () => {
    const g = asItWas('v0231-xy3060g');
    expectClear(g, 'XY3060');
    // Still a clash when the other duty overlaps his own work: the same check over the whole span says so.
    const f = flightOf(g, 'XY3060');
    const p = g.pairings[g.duties[f.dutyId!].pairingId];
    const rui = crewOf(g, 'Rui Ribeiro');
    const plan = planCrew(g, rui, p, segsOf(g, rui, p.id), true);
    expect(plan.issues.filter((i) => i.code === 'overlap')).toEqual([]);
  });

  it('B: a held seat is not re-checked against the planner\'s rotation holds (FR2040, Beatriz Ribeiro)', () => {
    const g = asItWas('v0231-fr2040');
    expectClear(g, 'FR2040');
  });

  it('C: the rest before a later trip is that trip\'s problem (EW6000 clear, FR2040 flagged)', () => {
    const g = asItWas('v0231-ew6000');
    expectClear(g, 'EW6000');
    // Her later trip (FR2040 on 22 Oct, its ticket out 5:10 after EW6000 lands) carries the short rest.
    const bea = crewOf(g, 'Beatriz Ribeiro');
    const fr = Object.values(g.flights).filter((f) => f.no === 'FR2040' && f.status === 'scheduled' && f.dutyId && g.pairings[g.duties[f.dutyId].pairingId]?.slots.some((s) => s.crewId === bea.id)).sort((a, b) => a.std - b.std)[0];
    const issues = crewIssuesFor(g, g.duties[fr.dutyId!]);
    expect(issues.find((x) => x.crewId === bea.id)?.issue.code).toBe('rest');
    // The self-check agrees with the alarm now raised on FR2040: the rest before the ticket is short on its own reading.
    const v = checkAlarm(g, 'hours', fr.id, { ...ALARM_HOOKS, fix: undefined });
    expect(v.confirmed).toBe(true);
  });

  it('D: no 12 h home rest before a ticket out to a duty away (CVE291, Léa Bernard)', () => {
    const g = asItWas('v0231-cve291');
    expectClear(g, 'CVE291');
  });
});

describe('rest before a ticket out (ORO.FTL.235(b), the away minimum)', () => {
  const T0 = 0;
  const ctx: TimelineCtx = { base: 'LIS', restUntil: -Infinity, lastRecovery: T0 - 60, blockYear: 0, blockYearOf: 2027 };
  const H = 60;
  const ticket = (start: number, len: number, from: string, to: string, fresh = false): Seg =>
    ({ kind: 'pos', start, end: start + len, fdp: 0, maxFdp: 0, block: 0, sectors: 0, aug: false, disruptive: false, rest: minRest({ dutyMin: len, atHome: to === 'LIS', augmented: false, tzShift: 0 }), at: to, from, fresh, dutyId: fresh ? 'd1' : undefined }) as Seg;
  const duty = (start: number, len: number, from: string, at: string): Seg =>
    ({ kind: 'duty', start, end: start + len, fdp: len - 30, maxFdp: 13 * H, block: 0, sectors: 2, aug: false, disruptive: false, rest: minRest({ dutyMin: len, atHome: at === 'LIS', augmented: false, tzShift: 0 }), at, from, fresh: true, dutyId: 'd1' }) as Seg;
  const rest = (segs: Seg[]) => evalSegs(ctx, segs).filter((i) => i.code === 'rest');

  it('home 09:35, ticket out 10:25 later: fine (10 h); 9:30 later: short', () => {
    const home = ticket(6 * H, 3 * H + 35, 'TRN', 'LIS');
    expect(rest([home, ticket(home.end + 10 * H + 25, 3 * H, 'LIS', 'FUE', true)])).toEqual([]);
    expect(rest([home, ticket(home.end + 9 * H + 30, 3 * H, 'LIS', 'FUE', true)])).toHaveLength(1);
  });

  it('a duty (an FDP) starting at home still needs the 12 h', () => {
    const home = ticket(6 * H, 3 * H + 35, 'TRN', 'LIS');
    expect(rest([home, duty(home.end + 10 * H + 25, 8 * H, 'LIS', 'LIS')])).toHaveLength(1);
    expect(rest([home, duty(home.end + 12 * H, 8 * H, 'LIS', 'LIS')])).toEqual([]);
  });
});
