// v0.22.1 the player's CVE166 (save "Chevron", 4 May 2027): CS-TSM flew a base programme out of Jeddah with three crew
// sets on station; its legs of 3–8 May were sub-leased so the aircraft could cover a grounded jet at Gatwick. The ferry
// out, JED–LGW, went uncrewed five times ("CVE161 … CVE166 has no crew") and each time the first Gatwick legs were
// sub-chartered, while three captains and three first officers sat at Jeddah with nothing until 9 May: a tour held its
// crew "busy" for the whole rotation (check.ts otherTrip). Pinned here:
// 1. a set on station flies a side trip that fits between its own tour duties, and goes back to the station after it;
// 2. the tour's own days stay protected (a trip over a tour duty is still refused);
// 3. the save heals on load (the red mark goes, the ferry is crewed from Jeddah) and the days after fly without a
//    crew alarm on the ferry or on the Jeddah programme.

import { describe, expect, it } from 'vitest';
import { DAY } from '../core/time';
import type { GameState } from '../core/types';
import { fixture } from '../fixtures/compatKit';
import { deserialize } from '../save';
import { advanceTo } from '../sim';
import { fixtureGame } from './fixtures';
import { acceptable, otherTrip, planCrew } from './check';
import { planLosses, refundPlanLosses } from './planRefund';
import { segsOf } from './timeline';

const load = (): GameState => deserialize(fixture('v022-cve166'));
/** The save as the older build left it: the once-on-load re-roster switched off. */
const raw = (): GameState => {
  const text = fixture('v022-cve166');
  const data = JSON.parse(text) as { state: GameState };
  data.state.stats.sideTripRedo = true;
  data.state.stats.planRefund = 0;
  return deserialize(JSON.stringify(data));
};

describe('CVE166: a set on station flies a side trip between its own tour duties', () => {
  it('the save as it was: the ferry out of Jeddah is red with nobody aboard', () => {
    const g = raw();
    const f = g.flights.f39l;
    expect(f.no).toBe('CVE166');
    expect(f.crewAlert).toBe('red');
    expect(f.crewIds).toEqual([]);
    // Three captains and three first officers at Jeddah, rested, their next tour duty days away.
    const jed = Object.values(g.crew).filter((c) => c.loc === 'JED' && (c.role === 'CPT' || c.role === 'FO') && c.restUntil <= g.now);
    expect(jed.length).toBe(6);
  });

  it('a Jeddah pilot can take it, with the way back to Jeddah (not home to Lisbon)', () => {
    const g = raw();
    const p = g.pairings[g.duties[g.flights.f39l.dutyId!].pairingId];
    const c = g.crew.c9;
    const plan = planCrew(g, c, p, segsOf(g, c), false, 60);
    expect(acceptable(g, plan)).toBe(true);
    expect(plan.out).toBeNull();
    expect(plan.home?.from).toBe('LGW');
    expect(plan.home?.to).toBe('JED');
    expect(plan.backTo).toBe('JED');
    // Back on station well before the set's next duty (F37080 on 9 May 03:00).
    expect(plan.home!.sta).toBeLessThan(g.flights.f1zx.std - DAY);
  });

  it('the tour still holds its crew over its own duties', () => {
    const g = raw();
    const p = g.pairings[g.duties[g.flights.f39l.dutyId!].pairingId];
    const c = g.crew.c9;
    const f = g.flights.f1zx;
    // A window over F37080 (9 May): the tour wins; the gap before it: free.
    expect(otherTrip(g, c, p, f.std - 60, f.sta + 30, false)?.tour).toBeTruthy();
    expect(otherTrip(g, c, p, g.flights.f39l.std - 60, g.flights.f39l.sta + 30, false)).toBeNull();
    // Not for someone who is not on the station.
    const lis = g.crew.c4;
    expect(lis.loc).toBe('LIS');
    expect(planCrew(g, lis, p, segsOf(g, lis), false, 60).backTo).toBeUndefined();
  });

  it('on load the ferry is crewed from Jeddah and the mark is gone', () => {
    const g = load();
    const f = g.flights.f39l;
    expect(f.crewAlert).toBeUndefined();
    expect(f.crewIds.length).toBe(2);
    for (const id of f.crewIds) expect(g.crew[id].loc).toBe('JED');
    const p = g.pairings[g.duties[f.dutyId!].pairingId];
    expect(p.slots.every((s) => s.backTo === 'JED')).toBe(true);
    const back = g.duties[f.dutyId!].deadheadIds.map((id) => g.flights[id]).filter((t) => t.kind === 'deadhead');
    expect(back.length).toBe(1);
    expect(back[0].from).toBe('LGW');
    expect(back[0].to).toBe('JED');
    expect([...back[0].crewIds].sort()).toEqual([...f.crewIds].sort());
    // A second load changes nothing (the repair runs once).
    const again = deserialize(JSON.stringify({ format: 'contrail-acmi-save', meta: {}, state: JSON.parse(JSON.stringify(g)) }));
    expect(again.flights.f39l.crewIds).toEqual(f.crewIds);
  });

  it('it flies on time, the pilots are back at Jeddah the next day and fly their tour', () => {
    const g = load();
    const ferry = g.flights.f39l;
    const ids = [...ferry.crewIds];
    const std = ferry.std;
    advanceTo(g, std + 2 * DAY, new Set());
    expect(g.flights.f39l.status).toBe('done');
    expect(g.flights.f39l.atd! - std).toBeLessThan(30);
    for (const id of ids) expect(g.crew[id].loc).toBe('JED');
    // The first Gatwick legs of 5 May flew with our own crew (no further sub-charter for want of a ferry crew).
    expect(g.flights.f309.operatedBy).toBeUndefined();
    expect(g.flights.f309.status).toBe('done');
    advanceTo(g, g.flights.f1zx.std + DAY, new Set());
    // F37080 on 9 May left Jeddah with its own set, on our aircraft.
    expect(g.flights.f1zx.status).toBe('done');
    expect(g.flights.f1zx.operatedBy).toBeUndefined();
    expect(g.flights.f1zx.crewIds.length).toBeGreaterThanOrEqual(4);
  }, 120_000);
});

describe('CVE166: the one-off refund for the planning error', () => {
  it('finds the four hand-overs the save ties to the error, and nothing of the player\'s own sub-lease', () => {
    const g = raw();
    const x = planLosses(g)!;
    expect(x.station).toBe('JED');
    expect(x.legs).toEqual(['CVE161', 'CVE163', 'CVE164', 'CVE165', 'CVE166']);
    expect(x.contracts.map((k) => k.id)).toEqual(['k2zs']);
    expect(x.items.map((i) => [i.no, i.kind, i.money])).toEqual([
      ['CVE161', 'subcharter', 52_000], ['CVE163', 'subcharter', 54_000], ['U27080', 'subcharter', 60_573], ['CVE165', 'subcharter', 67_000],
    ]);
    expect(x.money).toBe(233_573);
    // The month's sub-charter line is bigger: the Jeddah legs the player sub-leased on purpose are not given back.
    expect(-(g.finance.current.lines.subcharter ?? 0)).toBeGreaterThan(x.money + 100_000);
    expect(x.reliability).toBeCloseTo(6.4, 5);
    expect(x.relation).toEqual([['cx1d', 3.6]]);
  });

  it('on load: the money back on its own ledger line, reliability and the client\'s relation restored, one quiet line, once', () => {
    const before = raw();
    const g = load();
    expect(g.stats.planRefund).toBe(233_573);
    expect(g.finance.current.lines.refund).toBe(233_573);
    expect(g.finance.current.lines.subcharter).toBe(before.finance.current.lines.subcharter);
    expect(g.company.reputation.reliable).toBeCloseTo(before.company.reputation.reliable + 6.4, 5);
    expect(g.clients.cx1d.relation).toBeCloseTo(before.clients.cx1d.relation + 3.6, 5);
    const notes = g.messages.filter((m) => /^Refund: crew planning error/.test(m.title));
    expect(notes.length).toBe(1);
    expect(notes[0].cat).toBe('finance');
    expect(notes[0].body).toMatch(/crew at Jeddah could have flown the empty leg CVE161/);
    expect(notes[0].body).toMatch(/sub-charters \$234K; reliability \+6\.4, easyJet \+3\.6/);
    // Loaded again (and asked again): nothing more.
    const cash = g.company.cash;
    refundPlanLosses(g);
    const again = deserialize(JSON.stringify({ format: 'contrail-acmi-save', meta: {}, state: JSON.parse(JSON.stringify(g)) }));
    expect(again.company.cash).toBe(cash);
    expect(again.messages.filter((m) => /^Refund: crew planning error/.test(m.title)).length).toBe(1);
  });

  it('a later cancellation "waiting for crew" on the same job counts too; other losses do not', () => {
    const g = raw();
    const t = g.now + 60;
    g.now = t;
    g.messages.unshift(
      { id: 'mx1', t, read: false, tone: 'bad', cat: 'ops', title: '4 legs cancelled: U27060…', body: 'Waiting for crew: U27060 LGW–ALC would leave more than 6 h late, so they were dropped. Compensation $60K.', problem: { kind: 'penalty', ref: { kind: 'contract', id: 'k2zs' } }, hurt: { money: 60_000, pax: 0, delayMin: 0, level: 'high' } },
      // Another contract's cancellation, and a technical one on this job: not the planning error.
      { id: 'mx2', t, read: false, tone: 'bad', cat: 'ops', title: '2 legs cancelled: F37000…', body: 'Waiting for crew: dropped. Compensation $30K.', problem: { kind: 'penalty', ref: { kind: 'contract', id: 'k9f' } }, hurt: { money: 30_000, pax: 0, delayMin: 0, level: 'high' } },
      { id: 'mx3', t, read: false, tone: 'bad', cat: 'ops', title: '2 legs cancelled: U27000…', body: 'AOG: no spare aircraft. Compensation $30K.', problem: { kind: 'penalty', ref: { kind: 'contract', id: 'k2zs' } }, hurt: { money: 30_000, pax: 0, delayMin: 0, level: 'high' } },
    );
    g.clients.cx1d.log!.push([t, -3, 'Cancelled U27060']);
    const x = planLosses(g)!;
    expect(x.money).toBe(233_573 + 60_000);
    expect(x.items.filter((i) => i.kind === 'cancel').map((i) => i.msgId)).toEqual(['mx1']);
    expect(x.relation).toEqual([['cx1d', 6.6]]);
  });

  it('a game with no such alarm gets nothing, and a new game never asks', () => {
    const g = raw();
    g.messages = g.messages.filter((m) => !/this empty leg was planned/.test(m.body));
    expect(planLosses(g)).toBeNull();
    delete g.stats.planRefund;
    const cash = g.company.cash;
    refundPlanLosses(g);
    expect(g.stats.planRefund).toBe(0);
    expect(g.company.cash).toBe(cash);
    const fresh = fixtureGame(5);
    expect(fresh.stats.planRefund).toBe(0);
    expect(fresh.stats.sideTripRedo).toBe(true);
  });
});
