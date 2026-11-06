// v0.15 Scenarios: the rules (scenario/rules.ts) and the seeded history (scenario/history.ts). Every lock is refused by
// the engine's own action APIs (the store, dev and keyboard paths call these), the tools a scenario needs stay open,
// a 'penalty' cancel ends the run without stars, and each scenario steps into an airline with a believable, legal past.

import { describe, expect, it } from 'vitest';
import { ACMI_TYPES } from '../../data/acmiTypes';
import { AIRPORT_BY_CODE } from '../../data/airports';
import { bookTrip, devTender, fairsAhead, placeBid } from '../commercial';
import { acceptOffer, cancelContract, clientList, generateOffer } from '../contracts';
import { makeDryLeaseOffer } from '../contracts/missions';
import { finalizeDraft, type Draft } from '../contracts/offers';
import { statementTotals } from '../core/ledger';
import { techReliability } from '../core/techLog';
import { DAY, monthKey } from '../core/time';
import type { ApprovalId, Archetype, GameState } from '../core/types';
import { evalSegs } from '../crew/rules';
import { block12m, ctxOf, segsOf } from '../crew/timeline';
import { dropStrandedStandby } from '../crew/dayPlan';
import { hireCrew, startConversion, trainCrew } from '../crew';
import { createGame } from '../newGame';
import { acquireAircraft, applyApproval, approvalBlocker, bookRefit, bookRestRefit, chooseLease, returnEarly, saleQuote, sellAircraft, subcharter, subcharterable } from '../ops';
import { devMarketOffer } from '../ops/market';
import { moveTrip } from '../ops/tripMove';
import { deserialize, serialize } from '../save';
import { advanceTo } from '../sim';
import { createScenario, hiresLeft, lockOf, METRICS, rulesLines, SCENARIO_BY_ID, SCENARIOS, scenarioOutcome } from '.';
import { unknownAirports } from './history';
import { offerAirports, unreachableApproval, type LockKey } from './rules';

const NOT = /^Not in this scenario: /;
const KEYS: LockKey[] = ['cancel', 'market', 'tenders', 'sales', 'fleet', 'refits', 'hiring', 'training', 'approvals', 'move', 'subcharter'];
const ALL_KINDS: Archetype[] = ['seasonBase', 'aogCover', 'adhoc', 'sports', 'repatriation', 'tourSeries', 'troopRotation', 'capacityLease', 'hajj', 'unRotation', 'vip', 'deportation', 'evacuation', 'humanitarian', 'subcharterIn', 'dryLeaseOut', 'medical', 'musicTour', 'antarctic', 'worldTour'];
const cache = new Map<string, string>();
/** A fresh copy of the scenario at its start (built once per id). */
function fresh(id: string): GameState {
  if (!cache.has(id)) cache.set(id, serialize(createScenario(id)));
  return deserialize(cache.get(id)!);
}
const core = (g: GameState) => g.scen!.core!.map((id) => g.contracts[id]);
const fleetOf = (g: GameState, kind: 'owned' | 'dryLeaseIn') => Object.values(g.fleet).find((a) => a.ownership.kind === kind);

describe('v0.15 scenario rules: data', () => {
  it.each(SCENARIOS.map((d) => [d.id] as const))('%s has its rules and history', (id) => {
    const d = SCENARIO_BY_ID[id];
    const r = d.rules;
    expect(r).toBeDefined();
    expect(r.why.length).toBeGreaterThan(5);
    // Every scenario is a fixed fleet with no tenders, fairs or sales trips; moves between our own aircraft stay open.
    expect([r.fleet, r.tenders, r.sales, r.move]).toEqual([false, false, false, true]);
    if (r.market === 'themed') expect(r.themes!.length).toBeGreaterThan(0);
    for (const a of r.themes ?? []) expect(ALL_KINDS).toContain(a);
    if (r.hiring === 'limited') expect(r.hireMax).toBeGreaterThan(0);
    // The history names real clients and airports, a year of months.
    const h = d.history;
    expect(h.util).toHaveLength(12);
    for (const j of h.past) expect(unknownAirports(j)).toEqual([]);
    const g = fresh(id);
    const names = new Set(Object.values(g.clients).map((c) => c.name));
    for (const j of h.past) expect(names.has(j.client)).toBe(true);
    for (const [n] of h.rel) expect(names.has(n)).toBe(true);
    // The goals dialog lists the rules.
    expect(rulesLines(g).length).toBeGreaterThanOrEqual(6);
  });

  it('a normal game has no locks', () => {
    const g = createGame({ name: 'Test Air', code: 'TA', livery: { primary: '#0b1f4d', secondary: '#f5c451', tail: 'sweep' }, base: 'LIS', seed: 4 });
    for (const k of KEYS) expect(lockOf(g, k, { archetype: 'hajj', contractId: 'x', approval: 'etops180', count: 99 })).toBeNull();
    expect(hiresLeft(g)).toBeNull();
    expect(g.company.aocAt).toBeUndefined();
  });
});

describe('v0.15 scenario rules: the engine refuses what is locked', () => {
  it('cancelling the core contract: locked where it is the job (Hajj, Ash Cloud, Crew Crisis)', () => {
    for (const id of ['hajjAirlift', 'ashCloud', 'crewCrisis']) {
      const g = fresh(id);
      expect(g.scen!.core!.length).toBeGreaterThan(0);
      for (const c of core(g)) {
        const r = cancelContract(g, c.id);
        expect(r.ok).toBe(false);
        expect(!r.ok && r.error).toMatch(NOT);
        expect(g.contracts[c.id].status).toBe('signed');
      }
    }
  });

  it("cancelling the core contract under 'penalty' (Summer Surge, Southern Winter) ends the scenario with no stars", () => {
    for (const id of ['summerSurge', 'southernWinter']) {
      const g = fresh(id);
      const c = core(g)[0];
      expect(lockOf(g, 'cancel', { contractId: c.id })).toBeNull();
      expect(cancelContract(g, c.id).ok).toBe(true);
      expect(g.scen!.result?.stars).toBe(0);
      expect(g.scen!.result?.failed).toMatch(/We cancelled/);
      expect(g.gameOver).not.toBeNull();
      expect(scenarioOutcome(g)?.stars).toBe(0);
    }
  });

  it('a contract we signed ourselves may be cancelled where the rule is open (penalties apply)', () => {
    const g = fresh('cupFinal');
    expect(g.scen!.core).toEqual([]);
    expect(lockOf(g, 'cancel', { contractId: 'anything' })).toBeNull();
  });

  it('market: only the scenario’s kinds of work reach the desk; none when it is off', () => {
    for (const d of SCENARIOS) {
      const g = fresh(d.id);
      const r = d.rules;
      for (const o of Object.values(g.offers)) if (o.status === 'open') expect(lockOf(g, 'market', { archetype: o.archetype, airports: offerAirports(o) })).toBeNull();
      // v0.15.1 no Inbox line about an offer the rules withdrew or the setup signed (Crew Crisis opened with "Urgent:
      // Schedule cover, Manchester" and no market to find it on).
      for (const m of g.messages) if (m.ref?.kind === 'offer') expect(g.offers[m.ref.id]?.status, m.title).toBe('open');
      if (r.market === 'off') {
        expect(Object.values(g.offers).filter((o) => o.status === 'open')).toEqual([]);
        expect(generateOffer(g, 'adhoc')).toBeNull();
        expect(generateOffer(g)).toBeNull();
      }
      if (r.market === 'themed') {
        const off = ALL_KINDS.find((a) => !r.themes!.includes(a) && a !== 'dryLeaseOut')!;
        expect(lockOf(g, 'market', { archetype: off })).toMatch(NOT);
        for (let i = 0; i < 3; i++) expect(generateOffer(g, off)).toBeNull();
      }
      // A dry lease out is a fleet change: never in a scenario.
      expect(lockOf(g, 'market', { archetype: 'dryLeaseOut' })).toMatch(NOT);
    }
  });

  it('v0.15.1 a fixed fleet gets no dry-lease requests; a shut Ladder no work that needs an approval it cannot get', () => {
    const g = fresh('ashCloud');
    expect(makeDryLeaseOffer(g)).toBeNull();
    const s = fresh('summerSurge');
    expect(unreachableApproval(s, { etops: 120, approvals: [] })).toBe('etops120');
    expect(unreachableApproval(s, { etops: 0, approvals: ['dg'] })).toBe('dg');
    expect(unreachableApproval(s, { etops: 0, approvals: [] })).toBeNull();
    // Long-Haul Debut may file its long-haul approvals (two are pending already): that work stays on the desk.
    const l = fresh('longHaulDebut');
    expect(unreachableApproval(l, { etops: 180, approvals: ['widebody', 'augmented'] })).toBeNull();
    expect(unreachableApproval(l, { etops: 240, approvals: [] })).toBe('etops240');
    // A normal game: no rule, nothing unreachable.
    const n = createGame({ name: 'Debug Air', code: 'DB', livery: { primary: '#0b1f4d', secondary: '#f5c451', tail: 'sweep' }, base: 'LIS', seed: 3 });
    expect(unreachableApproval(n, { etops: 240, approvals: ['ulr'] })).toBeNull();
    // The market applies it: a hand-made job needing dangerous-goods approval never reaches Summer Surge's desk.
    const client = Object.values(s.clients).find((c) => c.name === 'Eurowings')!;
    const dep = s.now + 10 * DAY;
    const draft = (approvals: ApprovalId[]): Draft => ({
      archetype: 'adhoc', client, title: 'Test charter', blurb: 'Test.', pattern: { kind: 'legs', legs: [{ from: 'MAD', to: 'PMI', dep, flightNo: '', pax: 150 }, { from: 'PMI', to: 'MAD', dep: dep + DAY, flightNo: '', pax: 150 }] },
      req: { minSeats: 150, extraCabin: 0, approvals }, start: dep, end: dep + DAY + 6 * 60, expiresIn: 2 * DAY, effects: {}, risk: { disruption: 0.2, politics: 0, permit: 0 }, pin: 'PMI',
    });
    expect(finalizeDraft(s, draft(['dg']))).toBeNull();
    expect(finalizeDraft(s, draft([]))).not.toBeNull();
  });

  it('v0.15.1 Long-Haul Debut: ETOPS 120 is granted on its day (the maintenance programme was set up with the filing)', () => {
    const g = fresh('longHaulDebut');
    expect(g.company.etopsMx).toBeTruthy();
    const p = g.company.pendingApprovals.find((x) => x.id === 'etops120')!;
    advanceTo(g, p.done + DAY + 60, new Set());
    expect(g.company.approvals).toContain('etops120');
  });

  it('market: Southern Winter takes only work in South America', () => {
    const g = fresh('southernWinter');
    expect(lockOf(g, 'market', { archetype: 'seasonBase', airports: ['LIS', 'FAO'] })).toMatch(NOT);
    expect(lockOf(g, 'market', { archetype: 'seasonBase', airports: ['GRU', 'BSB'] })).toBeNull();
    for (const o of Object.values(g.offers)) if (o.status === 'open') expect(offerAirports(o).some((a) => ['BR', 'AR', 'CL', 'UY', 'PY', 'PE', 'BO', 'EC', 'CO', 'VE'].includes(AIRPORT_BY_CODE[a]?.country))).toBe(true);
  });

  it('accepting a locked offer is refused even when one is on the desk', () => {
    const g = fresh('hajjAirlift');
    // Forge an offer as the normal game would make it (rules off for a moment), then switch the rules back on.
    const coreIds = g.scen!.core;
    delete g.scen!.core;
    // v0.17 an ad hoc offer can come out null on a given draw: a few draws (the forging only needs one).
    let o = generateOffer(g, 'adhoc', { window: false });
    for (let i = 0; i < 20 && !o; i++) o = generateOffer(g, 'adhoc', { window: false });
    g.scen!.core = coreIds;
    expect(o).not.toBeNull();
    const ac = Object.keys(g.fleet)[0];
    const r = acceptOffer(g, o!.id, [ac]);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/Not in this scenario: both jumbos/);
  });

  it('tenders, fairs and sales trips are closed', () => {
    const g = fresh('summerSurge');
    const t = devTender(g);
    const ac = Object.keys(g.fleet)[0];
    const r = placeBid(g, t, { rate: 4000, mgh: 200, aircraftId: ac, crew: 'ours', start: g.now + 60 * DAY, end: g.now + 150 * DAY });
    expect(!r.ok && r.error).toMatch(NOT);
    const f = fairsAhead(g)[0];
    const b = bookTrip(g, 'ceo', { fairId: f.id });
    expect(!b.ok && b.error).toMatch(NOT);
    // No tenders are issued while the scenario runs.
    const h = fresh('summerSurge');
    advanceTo(h, h.now + 20 * DAY, new Set());
    expect((h.com?.tenders ?? []).length).toBe(0);
  });

  it('the fleet is fixed: no leasing, buying, selling, early returns or lease extensions; the aircraft market is empty', () => {
    for (const id of ['summerSurge', 'cashCrunch', 'longHaulDebut']) {
      const g = fresh(id);
      expect(g.market.aircraft).toEqual([]);
      expect(g.messages.some((m) => m.topic === 'market')).toBe(false);
      const coreIds = g.scen!.core;
      delete g.scen!.core;
      const offer = devMarketOffer(g, 'a320ceo', { kind: 'dryLeaseIn' });
      g.scen!.core = coreIds;
      const a = acquireAircraft(g, offer);
      expect(!a.ok && a.error).toMatch(NOT);
      const own = fleetOf(g, 'owned')!;
      expect(saleQuote(g, own.id).ok).toBe(false);
      const s = sellAircraft(g, own.id);
      expect(!s.ok && s.error).toMatch(/Not in this scenario|security/);
      const lease = fleetOf(g, 'dryLeaseIn')!;
      const e = returnEarly(g, lease.id, g.now + 120 * DAY);
      expect(!e.ok && e.error).toMatch(NOT);
      const x = chooseLease(g, lease.id, 'extend12');
      expect(!x.ok && x.error).toMatch(NOT);
    }
  });

  it('refits: closed except Long-Haul Debut (its A330 may need crew rest)', () => {
    const g = fresh('hajjAirlift');
    const ac = Object.keys(g.fleet)[0];
    const r = bookRefit(g, ac, '12J/156Y', g.company.homeBase, g.now + 30 * DAY);
    expect(!r.ok && r.error).toMatch(NOT);
    const s = bookRestRefit(g, ac, 'recliners', g.now + 30 * DAY);
    expect(!s.ok && s.error).toMatch(NOT);
    expect(lockOf(fresh('longHaulDebut'), 'refits')).toBeNull();
  });

  it('hiring: none, a limited allowance, or open', () => {
    const none = fresh('hajjAirlift');
    const r = hireCrew(none, { role: 'CC', family: 'B747', base: none.company.homeBase, count: 1 });
    expect(!r.ok && r.error).toMatch(/Not in this scenario: six crews/);
    expect(hiresLeft(none)).toBe(0);
    // Summer Surge: 12 summer hires, then no more.
    const g = fresh('summerSurge');
    expect(hiresLeft(g)).toBe(12);
    expect(hireCrew(g, { role: 'CC', family: 'A320', base: g.company.homeBase, count: 13 }).ok).toBe(false);
    expect(hireCrew(g, { role: 'CC', family: 'A320', base: g.company.homeBase, count: 8 }).ok).toBe(true);
    expect(hiresLeft(g)).toBe(4);
    expect(hireCrew(g, { role: 'CC', family: 'A320', base: g.company.homeBase, count: 4 }).ok).toBe(true);
    const last = hireCrew(g, { role: 'CC', family: 'A320', base: g.company.homeBase, count: 1 });
    expect(!last.ok && last.error).toMatch(NOT);
    // The allowance survives a save.
    expect(hiresLeft(deserialize(serialize(g)))).toBe(0);
    // Crew Crisis: 24; Long-Haul Debut: open.
    expect(hiresLeft(fresh('crewCrisis'))).toBe(24);
    expect(lockOf(fresh('longHaulDebut'), 'hiring', { count: 30 })).toBeNull();
  });

  it('training: closed where the scenario does not need it', () => {
    const g = fresh('cupFinal');
    const c = Object.values(g.crew).find((x) => x.role === 'FO')!;
    const r = trainCrew(g, c.id, 'command', c.ratings[0]);
    expect(!r.ok && r.error).toMatch(NOT);
    const k = startConversion(g, { crewIds: [c.id], family: 'B737', start: g.now + 10 * DAY });
    expect(!k.ok && k.error).toMatch(NOT);
    expect(lockOf(fresh('longHaulDebut'), 'training')).toBeNull();
    expect(lockOf(fresh('crewCrisis'), 'training')).toBeNull();
  });

  it('approvals: only those the scenario is about (Long-Haul Debut’s long-haul ladder)', () => {
    const g = fresh('summerSurge');
    expect(approvalBlocker(g, 'etops120')).toMatch(NOT);
    const r = applyApproval(g, 'etops120');
    expect(!r.ok && r.error).toMatch(NOT);
    const lh = fresh('longHaulDebut');
    expect(approvalBlocker(lh, 'augmented')).not.toMatch(NOT);
    expect(approvalBlocker(lh, 'iosa')).toBe('Already held');
    expect(approvalBlocker(lh, 'dg')).toMatch(NOT);
  });

  it('sub-charter: open where it is a legitimate tool, closed for the humanitarian missions', () => {
    expect(lockOf(fresh('aogFirefighter'), 'subcharter')).toBeNull();
    expect(lockOf(fresh('crewCrisis'), 'subcharter')).toBeNull();
    const g = fresh('humanitarian');
    const r = subcharter(g, ['nothing']);
    expect(!r.ok && r.error).toMatch(/Not in this scenario: nobody else/);
  });

  it('moving core trips between our own aircraft stays open (Hajj: swap the jumbos)', () => {
    const g = fresh('hajjAirlift');
    const c = core(g)[0];
    expect(lockOf(g, 'move', { contractId: c.id })).toBeNull();
    // Locked only where a scenario says so (none does): the check reads the rule.
    const f = Object.values(g.flights).find((x) => x.contractId === c.id)!;
    const r = moveTrip(g, f.id, Object.keys(g.fleet).find((id) => !c.aircraftIds.includes(id))!);
    if (!r.ok) expect(r.error).not.toMatch(NOT);
    expect(subcharterable(g, c.id).length).toBeGreaterThan(0);
  });

  it('an older scenario save gets its core contracts on load (its rules apply)', () => {
    const g = createScenario('hajjAirlift');
    const raw = JSON.parse(serialize(g)) as { state: GameState };
    delete raw.state.scen!.core;
    const h = deserialize(JSON.stringify(raw));
    expect(h.scen!.core!.sort()).toEqual([...g.scen!.core!].sort());
    const r = cancelContract(h, h.scen!.core![0]);
    expect(!r.ok && r.error).toMatch(NOT);
  });
});

describe('v0.15 scenario history: stepping into an established airline', () => {
  it.each(SCENARIOS.map((d) => [d.id] as const))('%s starts with a believable, legal past', (id) => {
    const d = SCENARIO_BY_ID[id];
    const g = fresh(id);
    const start = g.started;
    // The AOC is years old; the standing follows the record.
    expect(g.company.aocAt).toBeLessThan(start - 365 * DAY);
    expect(g.company.standing).toBeGreaterThanOrEqual(1);
    expect(g.stats.contractsDone).toBe(d.history.jobs);
    for (const [a] of d.history.granted) {
      expect(g.company.approvals).toContain(a);
      expect(g.company.approvalsAt![a]).toBeLessThan(start - 100 * DAY);
    }
    // A year of closed statements, chained, ending at the start's cash; the scenario's measures count none of it.
    const hs = g.finance.history;
    expect(hs.length).toBe(12);
    expect(hs.every((m) => m.closed && m.month < monthKey(start))).toBe(true);
    for (let i = 1; i < hs.length; i++) expect(hs[i].cashStart).toBe(hs[i - 1].cashEnd);
    expect(hs[hs.length - 1].cashEnd).toBe(g.finance.current.cashStart);
    const year = hs.reduce((s, m) => s + statementTotals(m.lines).revenue, 0);
    expect(year).toBeGreaterThan(5_000_000);
    expect(METRICS.revenue.value(g)).toBeLessThan(1);
    expect(Math.abs(METRICS.profit.value(g))).toBeLessThan(500_000);
    // Past jobs: completed before the start, counted by their clients, never by the scenario's tally.
    const past = Object.values(g.contracts).filter((c) => c.status === 'completed');
    expect(past.length).toBe(d.history.past.length);
    for (const c of past) {
      expect(c.end).toBeLessThan(start);
      expect(g.clients[c.clientId].jobs).toBeGreaterThan(0);
      expect(g.scen!.doneIds).toContain(c.id);
    }
    expect(clientList(g, 'working').length).toBeGreaterThanOrEqual(4);
    // Technical dispatch over 90 days reads (enough departures), near the airline's record.
    const t = techReliability(g, 90);
    if (d.history.util.slice(-3).some((x) => x > 0)) {
      expect(t.pct).not.toBeNull();
      expect(t.pct!).toBeGreaterThan(d.history.tech - 3);
    }
    // The authority audited the airline five weeks ago; the next audit is a year on (after the scenario).
    expect(g.opsx!.audit.last).toBeLessThan(start);
    expect(g.opsx!.audit.next).toBeGreaterThan(g.scen!.end);
    // Achievements and goals the record earns are dated before the start.
    for (const [a, at] of Object.entries(g.achievements ?? {})) if (a !== 'widebody') expect(at).toBeLessThan(start);
    for (const goal of g.goals) if (goal.done !== null) expect(goal.done).toBeLessThan(start);
  });

  it.each(SCENARIOS.map((d) => [d.id] as const))('%s crew records are legal at the start (FTL cumulative limits)', (id) => {
    const g = fresh(id);
    const start = g.started;
    let logged = 0;
    for (const c of Object.values(g.crew)) {
      // Seniority since the AOC; a rest of two days before the start.
      expect(c.hired).toBeGreaterThanOrEqual(g.company.aocAt! - DAY);
      expect(c.hired).toBeLessThan(start);
      for (const e of c.log) expect(e.end).toBeLessThanOrEqual(start - 2 * DAY);
      logged += c.log.length;
      const sum = (days: number) => c.log.filter((e) => e.end > start - days * DAY).reduce((s, e) => s + (e.end - e.start), 0) / 60;
      expect(sum(7)).toBeLessThanOrEqual(60);
      expect(sum(14)).toBeLessThanOrEqual(110);
      expect(sum(28)).toBeLessThanOrEqual(190);
      expect(c.log.reduce((s, e) => s + e.block, 0) / 60).toBeLessThanOrEqual(100);
      expect(block12m(c, start) / 60).toBeLessThan(1000);
      expect(c.blockYear / 60).toBeLessThan(900);
      // The engine's own check over the timeline: no cumulative limit broken.
      const bad = evalSegs(ctxOf(g, c), segsOf(g, c)).filter((i) => i.level === 'illegal' && ['duty7d', 'duty14d', 'duty28d', 'block28d', 'blockYear', 'recovery'].includes(i.code));
      expect(bad).toEqual([]);
    }
    // Every crew member but Cash Crunch's (idle since January) has flown recently.
    if (id !== 'cashCrunch') expect(logged).toBeGreaterThan(Object.keys(g.crew).length);
    else expect(logged).toBe(0);
  });

  it('fits each story: Hajj experience, the ETOPS of Southern Winter, Long-Haul Debut deliberately not yet', () => {
    const hj = fresh('hajjAirlift');
    expect(hj.achievements?.hajj).toBeLessThan(hj.started);
    expect(Object.values(hj.contracts).filter((c) => c.archetype === 'hajj' && c.status === 'completed').length).toBeGreaterThanOrEqual(4);
    expect(Object.values(hj.clients).find((c) => c.name === 'Royal Air Maroc')?.level).toBe('partner');
    const sw = fresh('southernWinter');
    expect(sw.company.approvals).toContain('etops120');
    expect(sw.company.etopsMx?.held).toBe(true);
    expect(Object.values(sw.clients).find((c) => c.name === 'GOL Linhas Aéreas')?.level).toBe('trusted');
    const lh = fresh('longHaulDebut');
    expect(lh.company.approvals).not.toContain('widebody');
    expect(lh.company.pendingApprovals.map((p) => p.id).sort()).toEqual(['etops120', 'widebody']);
    expect(Object.values(lh.crew).some((c) => c.ratings.includes('A330/340'))).toBe(false);
    // Cash Crunch: idle since January, the money owed booked in the months it was earned.
    const cc = fresh('cashCrunch');
    const last = cc.finance.history[cc.finance.history.length - 1];
    expect(last.bh).toBe(0);
    expect(last.lines.otherRevenue).toBeGreaterThan(0);
    expect(cc.finance.current.lines.otherRevenue ?? 0).toBe(0);
    expect(last.lines.interest).toBeLessThan(0);
    expect(cc.company.approvals).not.toContain('iosa');
    // Crew Crisis: the loyal half logged a full roster's year, under the 1,000 h.
    const cr = fresh('crewCrisis');
    for (const c of Object.values(cr.crew)) expect(block12m(c, cr.started) / 60).toBeLessThan(800);
    // The airline types fly at their ACMI rates (revenue per BH in a believable band).
    for (const d of SCENARIOS) {
      const g = fresh(d.id);
      const t = ACMI_TYPES[Object.values(g.fleet)[0].typeId];
      const m = g.finance.history.filter((x) => x.bh > 50);
      const rate = m.reduce((s, x) => s + statementTotals(x.lines).revenue, 0) / m.reduce((s, x) => s + x.bh, 0);
      expect(rate).toBeGreaterThan(t.rateBH * 0.6);
      expect(rate).toBeLessThan(t.rateBH * 2.6);
    }
  });

  it('is deterministic and saves: the same scenario twice is the same past', () => {
    const a = createScenario('aogFirefighter');
    const b = createScenario('aogFirefighter');
    const state = (x: GameState) => JSON.stringify((JSON.parse(serialize(x)) as { state: unknown }).state);
    expect(state(a)).toBe(state(b));
    const c = deserialize(serialize(a));
    expect(c.company.aocAt).toBe(a.company.aocAt);
    expect(c.finance.history).toEqual(a.finance.history);
  });
});

describe('v0.15 day planner: standby where the crew member is', () => {
  it('a hotel standby away from base goes when the crew member will not be there (the trip changed)', () => {
    const g = createGame({ name: 'Test Air', code: 'TA', livery: { primary: '#0b1f4d', secondary: '#f5c451', tail: 'sweep' }, base: 'LIS', seed: 6 });
    const c = Object.values(g.crew)[0];
    c.loc = 'LIS';
    c.standby = [{ from: g.now + 6 * 60, to: g.now + 18 * 60, kind: 'hotel', at: 'SID' }];
    dropStrandedStandby(g);
    expect(c.standby).toBeUndefined();
    // Where they will be, it stays.
    const d = Object.values(g.crew)[1];
    d.loc = 'SID';
    d.standby = [{ from: g.now + 6 * 60, to: g.now + 18 * 60, kind: 'hotel', at: 'SID' }];
    dropStrandedStandby(g);
    expect(d.standby).toHaveLength(1);
  });
});
