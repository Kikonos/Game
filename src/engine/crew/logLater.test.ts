// v0.23.1 log a later report time (crew/logLater.ts): offered only for a short rest or a day over its limit by at most
// an hour, once a duty, never for a crew member changed twice in 28 days; morale; the side-stream roll; save and load;
// the invariant checker counts it apart.

import { describe, expect, it } from 'vitest';
import { createChecker } from '../../../scripts/invariants';
import { addFlight } from '../core/entities';
import { BAL } from '../core/balance';
import { blockMinutes } from '../core/perf';
import { DAY } from '../core/time';
import type { GameState } from '../core/types';
import { logLaterFound } from '../ops/audit';
import { problemFor } from '../problems';
import { deserialize, serialize } from '../save';
import { advanceTo } from '../sim';
import { applyCrewFix, crewControl, flightCrewStatus, outOfHours } from '.';
import { buildDuties } from './duties';
import { addCrew, fixtureContract, fixtureGame } from './fixtures';
import { logLaterMorale, logLaterOffer, writeLogLater } from './logLater';
import { autoRoster, recheckPairing, releaseCrew, setFlightsCrew } from './roster';
import { segsOf, touchCrewState } from './timeline';

/** A rostered out-and-back from LIS two days out; its captain (outOfHours.test.ts's trip). */
function trip(seed = 21) {
  const g = fixtureGame(seed);
  const acId = Object.keys(g.fleet)[0];
  const ac = g.fleet[acId];
  ac.at = 'LIS';
  const std = Math.floor(g.now / DAY) * DAY + 2 * DAY + 9 * 60;
  const b = blockMinutes(ac.typeId, 'LIS', 'FNC');
  const k = fixtureContract(g, { pattern: { kind: 'legs', legs: [] }, aircraftIds: [acId], start: std - DAY, end: std + 2 * DAY, product: { kind: 'charter', price: 120_000, depositPct: 0.3, balanceDaysBefore: 7, fuelEscalation: false }, penalties: { cancelScale: [], perDelay: 2_500, perCancelledLeg: 15_000 } });
  const f = addFlight(g, { no: 'AW910', aircraftId: acId, contractId: k.id, kind: 'revenue', from: 'LIS', to: 'FNC', std, sta: std + b, pax: 170 });
  addFlight(g, { no: 'AW911', aircraftId: acId, contractId: k.id, kind: 'revenue', from: 'FNC', to: 'LIS', std: std + b + 50, sta: std + 2 * b + 50, pax: 160 });
  buildDuties(g, acId, g.now, g.now + 5 * DAY);
  for (const id of addCrew(g, { CPT: 2, FO: 2, PUR: 1, CC: 3 })) g.crew[id].off = [];
  autoRoster(g);
  const d = g.duties[g.flights[f.id].dutyId!];
  const p = g.pairings[d.pairingId];
  const cpt = p.slots.find((s) => s.role === 'CPT')!.crewId!;
  // Keep the captain on the seat (no re-roster behind the test's back): the player's roster.
  g.company.policies.autoRoster = false;
  return { g, f, d, p, cpt };
}

/** The captain's last duty (at home) ended so that the rest before the report is `short` minutes under 12 h. */
function shortRest(g: GameState, cpt: string, report: number, short: number) {
  const c = g.crew[cpt];
  const end = report - (12 * 60 - short);
  c.log.push({ start: end - 8 * 60, end, fdp: 7 * 60 + 30, block: 6 * 60, sectors: 2, augmented: false, disruptive: false });
  c.log.sort((a, b) => a.start - b.start);
  c.restUntil = end + 12 * 60;
  c.loc = 'LIS';
  touchCrewState(g);
}

describe('log a later report time: when it is offered', () => {
  it('a rest 40 min short: offered for +40 min, on the card and in Crew Control', () => {
    const { g, f, d, p, cpt } = trip();
    shortRest(g, cpt, d.report, 40);
    recheckPairing(g, p);
    expect(outOfHours(g, f.id).find((x) => x.crewId === cpt)?.limit).toBe('rest');
    const o = logLaterOffer(g, f.id);
    expect(o.ok).toBe(true);
    if (!o.ok) return;
    expect(o.min).toBe(40);
    expect(o.limit).toBe('rest');
    expect(o.who.map((x) => x.crewId)).toEqual([cpt]);
    const card = problemFor(g, { kind: 'crewHours', ref: { kind: 'flight', id: f.id } })!;
    expect(card.actions.map((a) => a.label)).toContain('Log a later report time (+40 min)');
    const v = crewControl(g, f.id)!;
    const row = v.solutions.find((s) => s.id === 'logLater')!;
    expect(row.available).toBe(true);
    expect(row.label).toBe('Log a later report time (+40 min)');
    expect(row.chips).toContain(`Morale ${logLaterMorale(40, 0)}`);
    // Never the first answer while a legal fix costs less (a standby captain is free here).
    expect(row.rank).toBeGreaterThan(1);
  });

  it('not offered beyond the cap, for a missing seat, the wrong place, sickness, or twice on one duty', () => {
    const a = trip();
    shortRest(a.g, a.cpt, a.d.report, 75);
    recheckPairing(a.g, a.p);
    const o = logLaterOffer(a.g, a.f.id);
    expect(o.ok).toBe(false);
    if (!o.ok) expect(o.why).toMatch(/too much to hide \(at most 60 min\)/);

    const b = trip();
    const fo = b.p.slots.find((s) => s.role === 'FO')!.crewId!;
    releaseCrew(b.g, b.p, fo);
    setFlightsCrew(b.g, b.p);
    expect(logLaterOffer(b.g, b.f.id).ok).toBe(false);
    shortRest(b.g, b.cpt, b.d.report, 30);
    recheckPairing(b.g, b.p);
    const ob = logLaterOffer(b.g, b.f.id);
    expect(ob.ok).toBe(false);
    if (!ob.ok) expect(ob.why).toMatch(/Seats are empty/);

    const c = trip(22);
    c.g.crew[c.cpt].loc = 'OPO';
    touchCrewState(c.g);
    recheckPairing(c.g, c.p);
    expect(logLaterOffer(c.g, c.f.id).ok).toBe(false);

    const s = trip();
    s.g.crew[s.cpt].blocks = [{ from: s.g.now, to: s.d.report + DAY, why: 'sick' }];
    touchCrewState(s.g);
    recheckPairing(s.g, s.p);
    expect(logLaterOffer(s.g, s.f.id).ok).toBe(false);
  });

  it('a crew member changed twice in 28 days refuses', () => {
    const { g, f, d, p, cpt } = trip();
    shortRest(g, cpt, d.report, 20);
    g.crew[cpt].adjusted = [g.now - 5 * DAY, g.now - 20 * DAY];
    recheckPairing(g, p);
    const o = logLaterOffer(g, f.id);
    expect(o.ok).toBe(false);
    if (!o.ok) expect(o.why).toMatch(/refuses/);
    // One of them older than 28 days: offered again, at twice the morale.
    g.crew[cpt].adjusted = [g.now - 5 * DAY, g.now - 40 * DAY];
    const o2 = logLaterOffer(g, f.id);
    expect(o2.ok).toBe(true);
    expect(logLaterMorale(20, 1)).toBe(logLaterMorale(20, 0) * BAL.logLater.morale.repeatX);
  });
});

describe('log a later report time: applied', () => {
  it('the flight is crewed, both times kept, morale and the record written, once per duty', () => {
    const { g, f, d, p, cpt } = trip();
    shortRest(g, cpt, d.report, 40);
    recheckPairing(g, p);
    const others = p.slots.map((s) => s.crewId).filter((id): id is string => !!id && id !== cpt);
    const m0 = Object.fromEntries(Object.values(g.crew).map((c) => [c.id, c.morale]));
    const real = d.report;
    const r = applyCrewFix(g, f.id, 'logLater', { confirmed: true });
    expect(r.ok).toBe(true);
    expect(flightCrewStatus(g, f.id, { live: false }).level).not.toMatch(/missing|illegal/);
    expect(g.duties[d.id].logged).toMatchObject({ min: 40, limit: 'rest', crewIds: [cpt], real });
    expect(g.duties[d.id].report).toBe(real);
    expect(g.crew[cpt].morale).toBeCloseTo(Math.max(0, m0[cpt] + logLaterMorale(40, 0)), 1);
    for (const id of others) expect(g.crew[id].morale).toBeCloseTo(Math.max(0, m0[id] + BAL.logLater.morale.others), 1);
    const bystander = Object.values(g.crew).find((c) => !p.slots.some((s) => s.crewId === c.id) && c.status !== 'joining')!;
    expect(bystander.morale).toBeCloseTo(Math.max(0, m0[bystander.id] + BAL.logLater.morale.company), 1);
    expect(g.crew[cpt].adjusted).toHaveLength(1);
    expect(g.opsx?.adjusted).toHaveLength(1);
    expect(g.messages.some((x) => /AW910 crewed: Log a later report time/.test(x.title))).toBe(true);
    const again = logLaterOffer(g, f.id);
    expect(again.ok).toBe(false);
  });

  it('only the crew whose limit it hides start later on record: the others are planned from the real report', () => {
    // (Final debug round: a cabin crew member on the same duty was given a home standby ending 12 h before the logged
    // report, 11:20 before the real one.)
    const { g, f, d, p, cpt } = trip();
    shortRest(g, cpt, d.report, 40);
    recheckPairing(g, p);
    const before = new Map(p.slots.filter((s) => s.crewId).map((s) => [s.crewId!, segsOf(g, g.crew[s.crewId!]).find((x) => x.kind === 'duty' && x.dutyId === d.id)!.start]));
    expect(applyCrewFix(g, f.id, 'logLater', { confirmed: true }).ok).toBe(true);
    const start = (id: string) => segsOf(g, g.crew[id]).find((x) => x.kind === 'duty' && x.dutyId === d.id)!.start;
    expect(start(cpt)).toBe(before.get(cpt)! + 40);
    for (const [id, s0] of before) if (id !== cpt) expect(start(id), g.crew[id].last).toBe(s0);
  });

  it('save and load keep the logged report, and the legality reads the same', () => {
    const { g, f, d, p, cpt } = trip();
    shortRest(g, cpt, d.report, 25);
    recheckPairing(g, p);
    expect(applyCrewFix(g, f.id, 'logLater', { confirmed: true }).ok).toBe(true);
    const h = deserialize(serialize(g));
    expect(h.duties[d.id].logged).toEqual(g.duties[d.id].logged);
    expect(h.crew[cpt].adjusted).toEqual(g.crew[cpt].adjusted);
    expect(h.opsx?.adjusted).toEqual(g.opsx?.adjusted);
    expect(flightCrewStatus(h, f.id, { live: false }).level).toBe(flightCrewStatus(g, f.id, { live: false }).level);
    expect(h.duties[d.id].fdp).toBe(g.duties[d.id].fdp);
  });

  it('the side-stream roll is deterministic, and a find costs a fine and an audit finding', () => {
    const { g, f, d, p, cpt } = trip();
    shortRest(g, cpt, d.report, 30);
    recheckPairing(g, p);
    const o = logLaterOffer(g, f.id);
    if (!o.ok) throw new Error(o.why);
    const a = structuredClone(g);
    const b = structuredClone(g);
    writeLogLater(a, a.duties[d.id], a.pairings[p.id], f.no, o);
    writeLogLater(b, b.duties[d.id], b.pairings[p.id], f.no, o);
    expect(a.opsx!.adjusted).toEqual(b.opsx!.adjusted);
    // Forced to come to light now: the fine (Approvals & audits) and a Level 2 roster finding.
    const rec = a.opsx!.adjusted![0];
    rec.foundAt = a.now;
    rec.how = 'report';
    const before = a.finance.current.lines.compliance ?? 0;
    logLaterFound(a);
    expect(rec.found).toBe(true);
    expect((a.finance.current.lines.compliance ?? 0) - before).toBe(-BAL.logLater.fineBase);
    const fd = a.opsx!.audit.findings.find((x) => x.area === 'roster')!;
    expect(fd.level).toBe(2);
    expect(fd.why).toMatch(/AW910 .*logged 30 min later/);
    expect(a.messages.some((x) => /reported the changed report time on AW910/.test(x.title))).toBe(true);
    // Once only.
    logLaterFound(a);
    expect(a.opsx!.audit.findings.filter((x) => x.area === 'roster')).toHaveLength(1);
  });

  it('the invariant checker counts the hidden rest apart (adjusted), never as an error', () => {
    const { g, f, d, p, cpt } = trip();
    shortRest(g, cpt, d.report, 40);
    recheckPairing(g, p);
    const inv = createChecker();
    inv.observe(g);
    expect(applyCrewFix(g, f.id, 'logLater', { confirmed: true }).ok).toBe(true);
    const end = g.duties[d.id].release + 2 * 60;
    while (g.now < end) {
      advanceTo(g, Math.min(end, g.now + 60));
      inv.observe(g);
    }
    inv.finish(g);
    expect(g.duties[d.id]?.done ?? true).toBe(true);
    const e = g.crew[cpt].log.find((x) => x.logged);
    expect(e?.logged).toBe(40);
    expect(inv.errors.filter((x) => x.code === 'rest' || x.code === 'rest<10h' || x.code === 'fdp' || x.code === 'adjust-cap')).toEqual([]);
    expect(inv.summary.adjusted.duties).toBe(1);
  });
});
