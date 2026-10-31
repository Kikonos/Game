// v0.10.2 technical dispatch reliability (core/techLog.ts) and the ETOPS maintenance programme (ops/company.ts): what
// counts as a technical failure, the minimum sample, old saves, and the programme's set-up, filing and grant.

import { afterEach, describe, expect, it } from 'vitest';
import { BAL } from '../core/balance';
import { flightsOf, removeFlights } from '../core/entities';
import { isTechReason, seedTechLog, techReliability } from '../core/techLog';
import { DAY, monthKey } from '../core/time';
import type { Flight, GameState, Minute } from '../core/types';
import { newGame, owned, run } from '../contracts/testkit';
import { addCrew } from '../crew/fixtures';
import { demoFlights } from '../dev';
import { advanceTo } from '../sim';
import { applyApproval, approvalBlocker, approvalReqs } from '.';
import { dailyApprovals, etopsMxState, onApprovalDone, setUpEtopsMx } from './company';
import { cancelLegs, pickRival, subcharterLegs } from './flights';

type Knobs = 'delayChance' | 'techDelayChance' | 'aogBase';
const bal = BAL as unknown as Record<Knobs, number>;
const saved = { delayChance: BAL.delayChance, techDelayChance: BAL.techDelayChance, aogBase: BAL.aogBase };
function calm(patch: Partial<Record<Knobs, number>> = {}) {
  Object.assign(bal, { delayChance: 0, techDelayChance: 0, aogBase: 0 }, patch);
}
afterEach(() => Object.assign(bal, saved));

const skip = (g: GameState, t: Minute) => advanceTo(g, t, new Set());
/** Revenue legs on the owned aircraft: there and back, `days` times. */
function legs(g: GameState, days = 1): Flight[] {
  const ac = owned(g);
  demoFlights(g, ['FAO'], days, 'revenue');
  // Only this aircraft flies (demoFlights gives every aircraft its legs).
  removeFlights(g, Object.values(g.flights).filter((f) => f.aircraftId !== ac.id).map((f) => f.id));
  return flightsOf(g, ac.id).filter((f) => f.status === 'scheduled' && f.kind === 'revenue');
}
const rec = (g: GameState) => Object.values(g.stats.techDisp ?? {}).reduce((a, [d, f]) => [a[0] + d, a[1] + f], [0, 0]);

describe('technical dispatch reliability (v0.10.2)', () => {
  it('a departure on time counts; a technical delay over 15 min is a failure; an operational delay is not', () => {
    calm();
    const g = newGame(8);
    const [a] = legs(g);
    skip(g, a.std + 1);
    expect(a.status).toBe('enroute');
    expect(rec(g)).toEqual([1, 0]);

    calm({ techDelayChance: 1 });
    const g2 = newGame(8);
    const [b] = legs(g2);
    run(g2, b.std + 1);
    expect(b.delayReason).toMatch(/^Technical/);
    expect(b.tech).toBe(true);
    skip(g2, b.std + 6 * 60);
    // Every leg that left had its technical delay (each rolled at its gate): over 15 min is a failure.
    const gone = Object.values(g2.flights).filter((f) => f.atd !== undefined && f.kind === 'revenue');
    expect(gone.length).toBeGreaterThan(0);
    expect(gone.every((f) => f.tech)).toBe(true);
    expect(rec(g2)).toEqual([gone.length, gone.filter((f) => f.atd! - (f.schedStd ?? f.std) > 15).length]);
    expect(rec(g2)[1]).toBeGreaterThan(0);

    calm({ delayChance: 1 });
    const g3 = newGame(8);
    const [c] = legs(g3);
    skip(g3, c.std + 6 * 60);
    expect(c.tech).toBeUndefined();
    expect(rec(g3)[1]).toBe(0);
  });

  it('cancelled for a technical reason is a failure; other cancellations are not departures', () => {
    calm();
    const g = newGame(9);
    const [a, b] = legs(g);
    cancelLegs(g, [a], 'AOG', 0);
    expect(rec(g)).toEqual([1, 1]);
    cancelLegs(g, [b], 'Client cancelled', 0, true);
    expect(rec(g)).toEqual([1, 1]);
    expect(isTechReason('AOG: waiting for parts')).toBe(true);
    expect(isTechReason('Maintenance overrun')).toBe(true);
    expect(isTechReason('CS-TQA grounded')).toBe(true);
    // A knock-on of a short technical delay on an earlier leg is not the aircraft's fault at this departure.
    expect(isTechReason('Recovery: Technical: APU')).toBe(false);
    expect(isTechReason('Late inbound aircraft')).toBe(false);
  });

  it('a sub-chartered technical leg that leaves on time counts as dispatched on time (recovering well helps)', () => {
    calm();
    const g = newGame(10);
    const [a] = legs(g);
    a.tech = true;
    const rival = pickRival(g, owned(g).typeId, [a]);
    expect(subcharterLegs(g, [a], rival, 0)).toBe(1);
    skip(g, a.sta + 1);
    expect(a.status).toBe('done');
    expect(rec(g)).toEqual([1, 0]);
  });

  it('needs 30 departures in the window; one decimal, rounded down; the window drops old days', () => {
    const g = newGame(11);
    const today = Math.floor(g.now / DAY);
    g.stats.techDisp = { [today]: [29, 0] };
    expect(techReliability(g, 90)).toEqual({ deps: 29, fails: 0, pct: null });
    g.stats.techDisp = { [today]: [1000, 36], [today - 100]: [500, 100] };
    expect(techReliability(g, 90)).toEqual({ deps: 1000, fails: 36, pct: 96.4 });
    expect(techReliability(g, 180).pct).toBe(90.9);
  });

  it('old saves: seeded from the revenue departures by month and the AOGs of the year', () => {
    const g = newGame(12);
    g.now += 60 * DAY;
    const k = monthKey(g.now);
    g.stats.v09 = { ...(g.stats.v09 ?? { legalStreak: 0, cover: {}, slips: 0, oohRed: 0, oohAmber: 0, discretionUsed: 0, discretionRefused: 0, headHandled: 0, headMistakes: 0, jumboLoads: 0, lateGovPaid: 0, cOnTime: 0 }), onTimeM: { [k - 1]: [120, 100], [k]: [60, 50] } };
    g.stats.incidents = [[g.now - 5 * DAY, 'aog'], [g.now - 3 * DAY, 'illegalCrew']];
    delete g.stats.techDisp;
    seedTechLog(g);
    const r = techReliability(g, 90);
    expect(r.deps).toBe(180);
    expect(r.fails).toBe(1);
    expect(r.pct).toBe(99.4);
  });
});

describe('ETOPS maintenance programme (v0.10.2)', () => {
  it('set up once: paid now, ready after BAL days; filing may go on meanwhile, the grant waits for it; ETOPS 180 reuses it', () => {
    const g = newGame(13);
    g.stats.techDisp = { [Math.floor(g.now / DAY)]: [200, 0] };
    const reqs = () => approvalReqs(g, 'etops120').find((r) => r.label === 'ETOPS maintenance programme')!;
    expect(reqs()).toMatchObject({ ok: false, have: 'not set up', action: 'etopsMx' });
    const cash = g.company.cash;
    expect(setUpEtopsMx(g)).toMatchObject({ ok: true });
    expect(g.company.cash).toBe(cash - BAL.ladder.etopsMx.cost);
    expect(etopsMxState(g)).toBe('pending');
    expect(setUpEtopsMx(g)).toEqual({ ok: false, error: 'Already being set up' });
    expect(reqs()).toMatchObject({ ok: true });
    expect(reqs().action).toBeUndefined();
    expect(approvalBlocker(g, 'etops120')).toBeNull();
    expect(applyApproval(g, 'etops120').ok).toBe(true);
    // The authority is done before the programme (forced here): the grant waits for it.
    const p = g.company.pendingApprovals[0];
    g.company.etopsMx!.done = p.done + 10 * DAY;
    g.stats.techDisp = { [Math.floor(p.done / DAY)]: [200, 0] };
    g.now = p.done;
    onApprovalDone(g, { t: g.now, seq: 0, type: 'approval.done', id: 'etops120', v: 0 });
    expect(g.company.approvals).not.toContain('etops120');
    expect(p.waiting).toMatch(/^Needs the ETOPS maintenance programme finished/);
    expect(g.messages.some((m) => m.title === 'ETOPS 120 waits for the ETOPS maintenance programme')).toBe(true);
    g.now += 10 * DAY;
    dailyApprovals(g);
    expect(etopsMxState(g)).toBe('held');
    expect(g.messages.some((m) => m.title === 'ETOPS maintenance programme approved')).toBe(true);
    expect(g.company.approvals).toContain('etops120');
    // ETOPS 180 uses the same programme: its row is met.
    addCrew(g, { CPT: 4, FO: 4 }, 'A320');
    expect(approvalReqs(g, 'etops180').find((r) => r.label === 'ETOPS maintenance programme')).toMatchObject({ ok: true, have: 'set up' });
    // Old saves have none.
    const old = newGame(14);
    delete old.company.etopsMx;
    expect(etopsMxState(old)).toBe('none');
  });

  it('every approval shows its technical reliability row at its target', () => {
    const g = newGame(15);
    g.stats.techDisp = { [Math.floor(g.now / DAY)]: [1000, 36] };
    const row = (id: Parameters<typeof approvalReqs>[1]) => approvalReqs(g, id).find((r) => /^Technical reliability/.test(r.label))!.label;
    expect(row('etops120')).toBe('Technical reliability 96.4% (needs 97%) over 90 days');
    // v0.14 Widebody operations at 95 % (was 97).
    expect(row('widebody')).toBe('Technical reliability 96.4% (needs 95%) over 90 days');
    expect(row('etops180')).toBe('Technical reliability 96.4% (needs 98%) over 180 days');
    expect(row('etops240')).toBe('Technical reliability 96.4% (needs 98%) over 180 days');
    expect(row('ulr')).toBe('Technical reliability 96.4% (needs 98.5%) over 365 days');
  });
});
