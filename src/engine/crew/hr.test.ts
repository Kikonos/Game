// HR, capacity, costs and the checkAssignment API (DESIGN §5.2, §5.4; BUILD-PLAN B2 acceptance).

import { describe, expect, it } from 'vitest';
import { BAL } from '../core/balance';
import { clearPause, takePause } from '../core/pause';
import { dayStart, DAY } from '../core/time';
import type { GameState } from '../core/types';
import { demoFlights } from '../dev';
import { advanceTo } from '../sim';
import { dailyCrewCosts, monthlySalaries } from './costs';
import { dailySickness } from './hr';
import { addCrew, fixtureContract, fixtureGame } from './fixtures';
import { autoRoster, checkAssignment, conversionEarliest, crewAvailability, flightCrewStatus, hireCrew, hireQuote, makeCrewMember, ratedMarket, removeCrew, resignNow, rosterOf, staffing, startConversion, trainCrew } from '.';

const run = (g: GameState, t: number) => advanceTo(g, t, new Set());
const line = (g: GameState, cat: string) => (g.finance.current.lines as Record<string, number>)[cat] ?? 0;

describe('hiring', () => {
  it('rated pilots: a pool per family every 30 days; beyond it an agency fee and a longer wait; cabin crew unlimited', () => {
    const g = fixtureGame();
    g.company.cash = 50_000_000;
    const m = ratedMarket(g, 'A330/340', 'CPT')!;
    expect(m).toEqual({ pool: BAL.ratedPool.wide.CPT, left: 2, fee: Math.round(BAL.salary.CPT[1] * 12 * BAL.ratedPool.feePct / 100) * 100 });
    expect(ratedMarket(g, 'A320', 'CC')).toBeNull();
    const req = { role: 'CPT' as const, family: 'A330/340' as const, base: 'LIS', count: 3 };
    const q = hireQuote(g, req);
    expect(q.beyondPool).toBe(1);
    expect(q.cost).toBe(3 * BAL.hireCost.pilot + m.fee);
    expect((q.readyAt - dayStart(g.now)) / DAY).toBeGreaterThanOrEqual(Math.round(BAL.hireDaysWide.CPT * 0.8 * BAL.ratedPool.daysMult));
    expect(hireCrew(g, req).ok).toBe(true);
    expect(ratedMarket(g, 'A330/340', 'CPT')!.left).toBe(0);
    expect(ratedMarket(g, 'A330/340', 'FO')!.left).toBe(BAL.ratedPool.wide.FO);
    expect(hireQuote(g, { ...req, count: 1 }).beyondPool).toBe(1);
    // The pool refills after 30 days.
    g.now += 31 * DAY;
    expect(ratedMarket(g, 'A330/340', 'CPT')!.left).toBe(2);
    expect(hireQuote(g, { role: 'CC', family: 'A320', base: 'LIS', count: 30 }).cost).toBe(30 * BAL.hireCost.cabin);
  });

  it('keeps the quoted ready date, charges once, and joins after hireDays', () => {
    const g = fixtureGame();
    const req = { role: 'FO' as const, family: 'A320' as const, base: 'LIS', count: 2 };
    const q = hireQuote(g, req);
    expect(hireQuote(g, req)).toEqual(q);
    const days = (q.readyAt - dayStart(g.now)) / DAY;
    expect(days).toBeGreaterThanOrEqual(Math.round(BAL.hireDays.FO * 0.8));
    expect(days).toBeLessThanOrEqual(Math.round(BAL.hireDays.FO * 1.2));
    expect(q.cost).toBe(2 * BAL.hireCost.pilot);
    const cash = g.company.cash;
    const r = hireCrew(g, req);
    expect(r.ok).toBe(true);
    const ids = r.ok ? r.data!.crewIds : [];
    expect(ids).toHaveLength(2);
    expect(g.company.cash).toBe(cash - q.cost);
    expect(line(g, 'hiring')).toBe(-q.cost);
    for (const id of ids) expect(g.crew[id].status).toBe('joining');
    // Not rosterable while joining.
    autoRoster(g);
    for (const id of ids) expect(rosterOf(g, id, g.now, q.readyAt)).toEqual([]);
    run(g, q.readyAt - 60);
    for (const id of ids) expect(g.crew[id].status).toBe('joining');
    run(g, q.readyAt + 60);
    for (const id of ids) {
      expect(['available', 'resting', 'onDuty']).toContain(g.crew[id].status);
      expect(g.crew[id].blocks?.some((b) => b.why === 'joining') ?? false).toBe(false);
    }
  });

  it('refuses bad requests without throwing', () => {
    const g = fixtureGame();
    expect(hireCrew(g, { role: 'FO', family: 'A320', base: 'LIS', count: 0 }).ok).toBe(false);
    expect(hireCrew(g, { role: 'FO', family: 'A320', base: 'ZZZZ', count: 1 }).ok).toBe(false);
    g.company.cash = 0;
    expect(hireCrew(g, { role: 'CPT', family: 'A320', base: 'LIS', count: 1 }).ok).toBe(false);
  });
});

describe('training', () => {
  it('type rating (v0.6: a one-person conversion class): 42 days from the earliest start, the new type replaces the old', () => {
    const g = fixtureGame();
    const fo = Object.values(g.crew).find((c) => c.role === 'FO')!;
    const cash = g.company.cash;
    const r = trainCrew(g, fo.id, 'typeRating', 'B757/767');
    expect(r.ok).toBe(true);
    expect(g.company.cash).toBe(cash - BAL.conv.pilotCost.wide);
    const k = Object.values(g.classes!)[0];
    expect(k.crewIds).toEqual([fo.id]);
    expect(k.start).toBeGreaterThanOrEqual(g.now + BAL.conv.leadDays * DAY);
    expect(k.end - k.start).toBe(BAL.conv.pilotDays * DAY);
    run(g, k.start + 60);
    expect(fo.status).toBe('training');
    run(g, k.end - 60);
    expect(fo.ratings).not.toContain('B757/767');
    run(g, k.end + 1);
    expect(fo.ratings).toEqual(['B757/767']);
    expect(fo.status).not.toBe('training');
  });

  it('command upgrade needs 4,000 h; SCCM course makes a CC senior', () => {
    const g = fixtureGame();
    const fo = Object.values(g.crew).find((c) => c.role === 'FO')!;
    fo.totalHours = 3_000;
    expect(trainCrew(g, fo.id, 'command', 'A320').ok).toBe(false);
    fo.totalHours = 5_000;
    expect(trainCrew(g, fo.id, 'command', 'A320').ok).toBe(true);
    const cc = Object.values(g.crew).find((c) => c.role === 'CC')!;
    expect(trainCrew(g, cc.id, 'sccm', 'A320').ok).toBe(true);
    run(g, dayStart(g.now) + BAL.sccmCourse.days * DAY + 1);
    expect(cc.role).toBe('PUR');
    expect(fo.role).toBe('FO');
    run(g, dayStart(g.now) + BAL.commandUpgrade.days * DAY);
    expect(fo.role).toBe('CPT');
  });

  it('training takes the crew member off rostered work and the slots are refilled', () => {
    const g = fixtureGame();
    demoFlights(g, undefined, 7, 'revenue');
    autoRoster(g);
    const c = Object.values(g.crew).find((x) => x.role === 'CC' && rosterOf(g, x.id, g.now + DAY, g.now + 6 * DAY).length)!;
    expect(trainCrew(g, c.id, 'typeRating', 'B737').ok).toBe(true);
    expect(rosterOf(g, c.id, g.now + DAY, g.now + 6 * DAY)).toEqual([]);
    const fl = Object.values(g.flights).filter((f) => f.aircraftId && f.status === 'scheduled' && f.std > g.now + DAY && f.std < g.now + 6 * DAY);
    expect(fl.filter((f) => flightCrewStatus(g, f.id).level === 'missing')).toEqual([]);
  });
});

describe('capacity (crewAvailability)', () => {
  it('covers a normal programme with the starting crew and shows the shortfall of a huge one', () => {
    const g = fixtureGame();
    const from = dayStart(g.now) + DAY;
    const ok = crewAvailability(g, 'A320', 'a320ceo', from, from + 30 * DAY, 200);
    expect(ok.firstShort).toBeNull();
    expect(ok.setsAvailable).toBeGreaterThanOrEqual(ok.setsNeeded);
    for (const r of Object.values(ok.byRole)) expect(r!.short).toBe(0);
    const big = crewAvailability(g, 'A320', 'a320ceo', from, from + 30 * DAY, 3_000);
    expect(big.firstShort).toBe(from);
    expect(big.byRole.CPT!.short).toBeGreaterThan(0);
    // Wrong family: nobody rated.
    expect(crewAvailability(g, 'B777', 'b77w', from, from + 30 * DAY, 200).setsAvailable).toBe(0);
  });

  it('other programmes hold their crews while active', () => {
    const g = fixtureGame();
    const from = dayStart(g.now) + DAY;
    const before = crewAvailability(g, 'A320', 'a320ceo', from, from + 30 * DAY, 200);
    const ac = Object.values(g.fleet)[0];
    fixtureContract(g, { aircraftIds: [ac.id], start: from, end: from + 60 * DAY, pattern: { kind: 'base', base: 'LIS', dests: ['FAO'], from, to: from + 60 * DAY, targetBH: 400, waves: [360, 720], prefix: 'NB', maintEvery: 7 } });
    const after = crewAvailability(g, 'A320', 'a320ceo', from, from + 30 * DAY, 200);
    expect(after.byRole.CPT!.free).toBeLessThan(before.byRole.CPT!.free);
    // Hired crew count only from their ready date.
    const r = hireCrew(g, { role: 'CPT', family: 'A320', base: 'LIS', count: 10 });
    expect(r.ok).toBe(true);
    const later = crewAvailability(g, 'A320', 'a320ceo', from + 80 * DAY, from + 90 * DAY, 200);
    const now = crewAvailability(g, 'A320', 'a320ceo', from, from + 10 * DAY, 200);
    expect(later.byRole.CPT!.free / 10).toBeGreaterThan(now.byRole.CPT!.free / 10);
  });

  it('staffing compares have with 5 sets per aircraft', () => {
    const g = fixtureGame();
    const n = Object.values(g.fleet).length;
    const cpt = staffing(g).find((l) => l.family === 'A320' && l.role === 'CPT')!;
    expect(cpt.need).toBe(BAL.crewSetsPerAircraft * n);
    expect(cpt.have).toBe(Object.values(g.crew).filter((c) => c.role === 'CPT').length);
  });

  it('crew on notice and pilots converting away from the type are not counted as staff', () => {
    const g = fixtureGame();
    g.company.cash = 50_000_000;
    const line = (r: string) => staffing(g).find((l) => l.family === 'A320' && l.role === r)!;
    const cpt0 = line('CPT');
    const cc0 = line('CC');
    const cpts = Object.values(g.crew).filter((c) => c.role === 'CPT').slice(0, 3).map((c) => c.id);
    expect(startConversion(g, { crewIds: cpts, family: 'A330/340', start: conversionEarliest(g) }).ok).toBe(true);
    expect(line('CPT')).toMatchObject({ have: cpt0.have - 3, converting: 3, leaving: 0 });
    const ccs = Object.values(g.crew).filter((c) => c.role === 'CC').slice(0, 2);
    for (const c of ccs) resignNow(g, c.id);
    expect(line('CC')).toMatchObject({ have: cc0.have - 2, leaving: 2, converting: 0 });
    // Cabin crew keep the old type: not converting away.
    const more = Object.values(g.crew).filter((c) => c.role === 'CC' && !c.notice).slice(0, 2).map((c) => c.id);
    expect(startConversion(g, { crewIds: more, family: 'A330/340', start: conversionEarliest(g) }).ok).toBe(true);
    expect(line('CC').have).toBe(cc0.have - 2);
  });
});

describe('crew costs', () => {
  it('per diem for crew away, hotels at outstations, salaries with on-costs (joining unpaid)', () => {
    const g = fixtureGame();
    const cpt = Object.values(g.crew).find((c) => c.role === 'CPT')!;
    cpt.awaySince = g.now;
    cpt.loc = 'MAD';
    cpt.status = 'resting';
    const pd = line(g, 'perDiem');
    const ht = line(g, 'hotels');
    dailyCrewCosts(g);
    expect(line(g, 'perDiem') - pd).toBe(-BAL.perDiem.CPT);
    expect(line(g, 'hotels') - ht).toBe(-BAL.hotelPerNight[4]);
    g.company.policies.perDiemPct = 50;
    dailyCrewCosts(g);
    expect(line(g, 'perDiem') - pd).toBe(-1.5 * BAL.perDiem.CPT);
    const j = makeCrewMember(g, 'FO', 'A320', 'LIS', 'joining');
    g.crew[j.id] = j;
    const paid = Object.values(g.crew).filter((c) => c.status !== 'joining').reduce((n, c) => n + c.salary, 0);
    const s0 = line(g, 'salaries');
    monthlySalaries(g);
    expect(line(g, 'salaries') - s0).toBe(-Math.round(paid * (1 + BAL.onCosts)));
  });
});

describe('checkAssignment', () => {
  it('reports rating, status, overlap and accepts the rostered crew', () => {
    const g = fixtureGame();
    demoFlights(g, undefined, 5, 'revenue');
    autoRoster(g);
    const duties = Object.values(g.duties).filter((d) => d.report > g.now + DAY).sort((a, b) => a.report - b.report);
    const d = duties[0];
    const p = g.pairings[d.pairingId];
    const onIt = p.slots.find((s) => s.crewId)!.crewId!;
    expect(checkAssignment(g, onIt, d.id).level).not.toBe('illegal');
    // Unrated.
    const [x] = addCrew(g, { CC: 1 }, 'B777');
    expect(checkAssignment(g, x, d.id).issues.map((i) => i.code)).toContain('rating');
    // Sick during the duty.
    const [y] = addCrew(g, { CC: 1 });
    g.crew[y].blocks = [{ from: d.report - 60, to: d.release + 60, why: 'sick' }];
    expect(checkAssignment(g, y, d.id).issues.map((i) => i.code)).toContain('status');
    // Someone on another aircraft's duty at the same time.
    const other = duties.find((e) => g.pairings[e.pairingId].aircraftId !== p.aircraftId && e.report < d.release && e.release > d.report)!;
    expect(other).toBeTruthy();
    const busy = g.pairings[other.pairingId].slots.find((s) => s.crewId)!.crewId!;
    const codes = checkAssignment(g, busy, d.id).issues.map((i) => i.code);
    expect(codes.some((c) => c === 'overlap' || c === 'rest')).toBe(true);
    expect(checkAssignment(g, busy, d.id).level).toBe('illegal');
  });

  it('removeCrew (sickness) frees the window and refills the slots', () => {
    const g = fixtureGame();
    demoFlights(g, undefined, 7, 'revenue');
    addCrew(g, { CPT: 2, FO: 2, PUR: 2, CC: 4 });
    autoRoster(g);
    const c = Object.values(g.crew).find((x) => x.role === 'CPT' && rosterOf(g, x.id, g.now + DAY, g.now + 4 * DAY).length)!;
    const res = removeCrew(g, c.id, g.now + DAY, g.now + 4 * DAY);
    expect(rosterOf(g, c.id, g.now + DAY, g.now + 4 * DAY)).toEqual([]);
    expect(res.uncovered).toEqual([]);
  });
});

describe('shortage and sickness', () => {
  it('uncovered flights within 48 h: one amber crew message (the v0.7.1 ladder), no pause until 12 h', () => {
    const g = fixtureGame();
    for (const c of Object.values(g.crew)) if (c.role === 'CPT') delete g.crew[c.id];
    demoFlights(g, undefined, 3, 'revenue');
    clearPause();
    const res = autoRoster(g);
    expect(res.uncovered.length).toBeGreaterThan(0);
    // The demo flights start in 30 min: the first wave is red (one message per duty, the pause), the later ones
    // amber (one message per batch, no pause). Every message carries the problem card and its hurt snapshot.
    expect(takePause()).toBe('crewShortage');
    const red = g.messages.filter((m) => m.cat === 'crew' && m.tone === 'bad' && m.topic === 'crewRed');
    const amber = g.messages.filter((m) => m.cat === 'crew' && m.tone === 'warn' && m.problem?.kind === 'crewShort');
    expect(red.length).toBeGreaterThan(0);
    expect(amber).toHaveLength(1);
    expect(red[0].problem?.kind).toBe('crewShort');
    expect(amber[0].hurt).toBeDefined();
    expect(res.uncovered.map((id) => g.flights[id].crewAlert)).toContain('amber');
    expect(res.uncovered.map((id) => g.flights[id].crewAlert)).toContain('red');
    // Warned once per flight: a second pass adds nothing and pauses nothing.
    clearPause();
    const n = g.messages.length;
    autoRoster(g);
    expect(g.messages.length).toBe(n);
    expect(takePause()).toBeNull();
  });

  it('a sick crew member is taken off the roster; an unfillable slot becomes a sickCrew decision', () => {
    const g = fixtureGame();
    demoFlights(g, undefined, 7, 'revenue');
    autoRoster(g);
    // One rostered captain may fall sick; every other captain is on leave (keeps their duties, takes no new ones).
    const cpts = Object.values(g.crew).filter((c) => c.role === 'CPT');
    const x = cpts.find((c) => rosterOf(g, c.id, g.now + DAY, g.now + 3 * DAY).length)!;
    for (const c of cpts) {
      if (c === x) continue;
      c.blocks = [{ from: g.now, to: g.now + 10 * DAY, why: 'leave' }];
      c.status = 'leave';
    }
    x.morale = 0;
    let sick;
    for (let i = 0; i < 2000 && !sick; i++) {
      dailySickness(g);
      // The sick call covers the coming days (from tomorrow, or after today's duty).
      if (x.blocks?.some((b) => b.why === 'sick')) sick = x;
    }
    expect(sick).toBeTruthy();
    const block = sick!.blocks!.find((b) => b.why === 'sick')!;
    expect(block.from).toBeGreaterThan(g.now);
    expect(rosterOf(g, sick!.id, block.from, block.to).filter((d) => d.report >= block.from)).toEqual([]);
    const dec = g.decisions.find((d) => d.kind === 'sickCrew' && (d.data as { crewId?: string })?.crewId === x.id);
    expect(dec?.data).toMatchObject({ crewId: sick!.id });
  });
});
