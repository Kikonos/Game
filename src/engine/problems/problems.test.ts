// v0.7.1 every kind of problem as one card (UPDATE-0.7.1.md §17): each kind produces non-empty what/why/hurt and an
// action; problems(g) lists AOG, check due, cash low, late invoice and an unflyable offer when present; postProblem
// sets the problem ref and hurt snapshot; the badge table.

import { describe, expect, it } from 'vitest';
import { generateOffer } from '../contracts';
import { BAL } from '../core/balance';
import { addFlight } from '../core/entities';
import { blockMinutes } from '../core/perf';
import { DAY } from '../core/time';
import type { GameState, Receivable } from '../core/types';
import { addCrew, fixtureContract, fixtureGame } from '../crew/fixtures';
import { devCrewShortage, demoFlights } from '../dev';
import { autoRoster, crewControl, crewShortCard } from '../crew';
import { releaseCrew, setFlightsCrew } from '../crew/roster';
import { startAog } from '../ops/maintenance';
import { advanceTo } from '../sim';
import { hurtBadges, mkHurt, postProblem, problemAt, problemFor, problems } from '.';
import { cardUnderStrip } from './crew';
import { hurtProse, type ProblemCard } from './types';

function game(): GameState {
  const g = fixtureGame(9);
  demoFlights(g, undefined, 3, 'revenue');
  autoRoster(g);
  advanceTo(g, g.now + 6 * 60);
  return g;
}

describe('hurt', () => {
  it('badges: none → no cost; $12,400 → $12K; 180 pax; 125 min → 2 h late; at most two', () => {
    expect(hurtBadges({ money: 0, pax: 0, delayMin: 0, level: 'none' })).toEqual(['no cost']);
    expect(hurtBadges({ money: 12_400, pax: 0, delayMin: 0, level: 'high' })).toEqual(['$12K']);
    expect(hurtBadges({ money: 0, pax: 180, delayMin: 0, level: 'high' })).toEqual(['180 pax']);
    expect(hurtBadges({ money: 0, pax: 0, delayMin: 125, level: 'none' })).toEqual(['2 h late']);
    expect(hurtBadges({ money: 42_000, pax: 180, delayMin: 125, level: 'high' })).toEqual(['$42K', '180 pax']);
  });

  it('levels: none / low / high by the §1 thresholds, with the text', () => {
    expect(mkHurt({ empty: true, delayMin: 180, what: 'penalty' })).toMatchObject({ level: 'none', text: 'Not much: empty flight, ~3 h late, no penalty' });
    expect(mkHurt({ money: 9_000, pax: 50, what: 'penalty' }).level).toBe('low');
    expect(mkHurt({ money: 42_000, pax: 180, what: 'penalty' })).toMatchObject({ level: 'high', text: 'Yes: 180 passengers, $42K penalty' });
  });
});

describe('crew WHY (v0.7.1 fixes 4 and 16)', () => {
  it('a flight without a duty says so and points at Auto-fix; the place sentence names only people away from the airport', () => {
    const g = fixtureGame(11);
    const acId = Object.keys(g.fleet)[0];
    const ac = g.fleet[acId];
    ac.at = 'DUS';
    const std = Math.floor(g.now / DAY) * DAY + 2 * DAY + 17 * 60;
    const b = blockMinutes(ac.typeId, 'DUS', 'FNC');
    const k = fixtureContract(g, { pattern: { kind: 'legs', legs: [] }, aircraftIds: [acId], start: std - DAY, end: std + 2 * DAY, product: { kind: 'charter', price: 120_000, depositPct: 0.3, balanceDaysBefore: 7, fuelEscalation: false }, penalties: { cancelScale: [], perDelay: 2_500, perCancelledLeg: 15_000 } });
    const f1 = addFlight(g, { no: 'AW816', aircraftId: acId, contractId: k.id, kind: 'revenue', from: 'DUS', to: 'FNC', std, sta: std + b, pax: 170 });
    addFlight(g, { no: 'AW817', aircraftId: acId, contractId: k.id, kind: 'revenue', from: 'FNC', to: 'DUS', std: std + b + 50, sta: std + 2 * b + 50, pax: 160 });
    addCrew(g, { CPT: 2, FO: 2, PUR: 1, CC: 3 });
    // No duty yet: the card says so instead of 'nobody is free'.
    const none = crewShortCard(g, f1.id)!;
    expect(none).not.toBeNull();
    expect(none.why).toBe(`AW816 has no crew plan yet: the roster plans ${BAL.rosterHorizonDays} days ahead; Auto-fix plans it now.`);
    const v = crewControl(g, f1.id)!;
    const auto = v.solutions.find((x) => x.id === 'autoFix')!;
    expect(auto.available).toBe(true);
    expect(auto.rank).toBe(1);
    expect(auto.preview.after.level).toBe('ok');
    // Rostered, short of a captain 2 h before report; a second captain sits at DUS resting: the sentence names
    // Lisbon alone, the mini-map lists nobody at the airport and the bar carries the ticket.
    autoRoster(g);
    const d = g.duties[g.flights[f1.id].dutyId!];
    const p = g.pairings[d.pairingId];
    const was = p.slots.find((x) => x.role === 'CPT' && x.crewId)!.crewId!;
    releaseCrew(g, p, was);
    setFlightsCrew(g, p);
    g.now = d.report - 2 * 60;
    const other = Object.values(g.crew).find((c) => c.role === 'CPT' && c.id !== was)!;
    other.loc = 'DUS';
    other.status = 'resting';
    other.restUntil = d.report + 3 * 60;
    other.log.push({ start: d.report - 14 * 60, end: d.report - 8 * 60, fdp: 6 * 60, block: 300, sectors: 2, augmented: false, disruptive: false });
    for (const c of Object.values(g.crew)) if (c.role === 'CPT' && c.id !== was && c.id !== other.id) { c.blocks = [{ from: g.now - DAY, to: g.now + 10 * DAY, why: 'leave' }]; c.status = 'leave'; }
    const card = crewShortCard(g, f1.id)!;
    // v0.12.1 who is at the departure comes first (BLU1570), then the place story of those away.
    expect(card.why).toMatch(/^In Düsseldorf: \S+ \S+ is resting until 19:00\. Your free captains are in Lisbon and the earliest they can land in Düsseldorf is/);
    expect(card.why).not.toMatch(/Düsseldorf and|and Düsseldorf/);
    expect(card.visuals.minimap!.crew.every((c) => c.at !== 'DUS')).toBe(true);
    expect(card.visuals.reach!.legs.length).toBeGreaterThan(0);
    expect(card.details.some((l) => /legal, free|legal, close to a limit|resting until|landing .* at the earliest/.test(l))).toBe(true);
    expect(card.details.some((l) => /: $/.test(l))).toBe(false);
  });
});

describe('cards', () => {
  it('crew: the shortage card from the dev helper; a sick crew member; a resignation', () => {
    const g = game();
    const id = devCrewShortage(g, { hours: 24 });
    expect(id).toBeTruthy();
    const c = problemFor(g, { kind: 'crewShort', ref: { kind: 'flight', id } })!;
    expect(c).not.toBeNull();
    expect(c.what).toMatch(/has no pilots|is missing/);
    expect(c.why.length).toBeGreaterThan(10);
    expect(c.hurt.text).toBeTruthy();
    expect(c.actions[0].id).toBe('crewControl');
    expect(problemAt(g, { kind: 'flight', id })?.subject.kind).toBe('crewShort');
    expect(problems(g).some((x) => x.subject.kind === 'crewShort' && x.subject.ref.id === id)).toBe(true);
    const sick = Object.values(g.crew)[0];
    sick.status = 'sick';
    sick.blocks = [{ from: g.now, to: g.now + 3 * DAY, why: 'sick' }];
    const s = problemFor(g, { kind: 'crewSick', ref: { kind: 'crew', id: sick.id } })!;
    expect(s.what).toMatch(/is sick until/);
    expect(s.actions.length).toBeGreaterThan(0);
    const leaving = Object.values(g.crew)[1];
    leaving.notice = { given: g.now - DAY, leaves: g.now + 10 * DAY };
    const r = problemFor(g, { kind: 'crewResigned', ref: { kind: 'crew', id: leaving.id } })!;
    expect(r.what).toMatch(/leaves in 10 days/);
    expect(r.actions[0].id).toBe('hire');
  });

  it('tech: AOG with a timeline; a check due with a gauge; grounded', () => {
    const g = game();
    const ac = Object.values(g.fleet)[0];
    const f = Object.values(g.flights).find((x) => x.aircraftId === ac.id && x.status === 'scheduled')!;
    ac.at = f.from;
    startAog(g, ac, f);
    const a = problemFor(g, { kind: 'aog', ref: { kind: 'aircraft', id: ac.id } })!;
    // The WHY names how it is being fixed (the decision, else what the fault needs), never 'part by courier' for a tyre.
    expect(a.why).toMatch(/^Repair about .+ \((waiting for your decision|local repair|part by courier|an AOG team flies in|local fix with the fly-away kit)\); back /);
    const m = g.maintenance[ac.maintId!];
    if (/tyre|brake|bird|tug/i.test(m.cause ?? '') && !g.decisions.some((d) => d.kind === 'aog')) expect(a.why).toContain('(local repair)');
    expect(a).not.toBeNull();
    expect(a.what).toMatch(new RegExp(`^${ac.reg} can't fly: `));
    expect(a.why).toMatch(/^Repair about /);
    expect(a.visuals.timeline?.marks.length).toBeGreaterThanOrEqual(2);
    expect(a.actions.some((x) => x.id === 'schedule')).toBe(true);
    expect(problems(g).some((x) => x.subject.kind === 'aog')).toBe(true);
    const b = Object.values(g.fleet)[1];
    b.maint.fhSinceA = 700;
    const c = problemFor(g, { kind: 'checkDue', ref: { kind: 'aircraft', id: b.id } })!;
    expect(c).not.toBeNull();
    expect(c.what).toMatch(/needs its A-check by|A-check is overdue/);
    expect(c.visuals.gauges?.[0].text).toMatch(/% used$/);
    expect(c.actions[0].id).toBe('planCheck');
    expect(problems(g).some((x) => (x.subject.kind === 'checkDue' || x.subject.kind === 'checkOverdue') && x.subject.ref.id === b.id)).toBe(true);
    b.maint.fhSinceA = 900;
    const gr = problemFor(g, { kind: 'grounded', ref: { kind: 'aircraft', id: b.id } })!;
    expect(gr.subject.kind).toBe('grounded');
    expect(gr.severity).toBe('red');
  });

  it('money: cash low with the date; a late invoice; a loss month', () => {
    const g = game();
    // Round 4: at or above zero with the forecast dipping under: the low-cash card with the date.
    g.company.cash = 10_000;
    const c = problemFor(g, { kind: 'cashLow', ref: { kind: 'cash', id: 'cash' } })!;
    expect(c).not.toBeNull();
    expect(c.what).toMatch(/^Cash runs out on /);
    expect(c.hurt.money).toBeGreaterThan(0);
    expect(c.visuals.timeline).toBeDefined();
    expect(problems(g).some((x) => x.subject.kind === 'cashLow')).toBe(true);
    expect(problemAt(g, { kind: 'cash', id: 'cash' })?.subject.kind).toBe('cashLow');
    // v0.9 round 4 (§S): below zero the cash-negative card (red, the rescue clock) is the one cash problem: no second
    // 'Cash runs out' card beside it, and its days-in-the-red gauge carries no `by` (the card line has the date).
    g.company.cash = -200_000;
    expect(problemFor(g, { kind: 'cashLow', ref: { kind: 'cash', id: 'cash' } })).toBeNull();
    const cashCards = problems(g).filter((x) => x.subject.ref.kind === 'cash');
    expect(cashCards.map((x) => x.subject.kind)).toEqual(['cashNegative']);
    const neg = problemAt(g, { kind: 'cash', id: 'cash' })!;
    expect(neg.subject.kind).toBe('cashNegative');
    expect(neg.what).toMatch(/^Cash is below zero \(/);
    expect(neg.severity).toBe('red');
    expect(neg.hurt.text).toMatch(/investor offers a rescue/);
    expect(neg.visuals.gauges?.[0].by).toBeUndefined();
    const cl = Object.values(g.clients)[0];
    const r: Receivable = { id: 'r-late', clientId: cl.id, contractId: null, desc: 'Test invoice', amount: 610_000, issued: g.now - 60 * DAY, due: g.now - 30 * DAY, payAt: g.now + 10 * DAY, paid: null, cat: 'charterRevenue' };
    g.finance.receivables.push(r);
    const inv = problemFor(g, { kind: 'invoiceOverdue', ref: { kind: 'contract', id: r.id } })!;
    expect(inv.what).toBe(`${cl.name} is 30 days late with $610K`);
    expect(inv.severity).toBe('red');
    expect(problems(g).some((x) => x.subject.kind === 'invoiceOverdue')).toBe(true);
    g.finance.history.push({ month: 0, lines: { acmiRevenue: 100_000, rent: -310_000 }, bh: 40, cashStart: 0, cashEnd: -210_000, closed: true });
    const loss = problemFor(g, { kind: 'lossMonth', ref: { kind: 'statement', id: '0' } })!;
    expect(loss.what).toMatch(/lost \$210K$/);
    expect(loss.actions[0].id).toBe('findWork');
  });

  it('commercial: an offer we cannot fly as it stands names the one thing in the way and its fix', () => {
    const g = game();
    const o = generateOffer(g, 'seasonBase', { wide: true, start: g.now + 20 * DAY });
    if (!o) return;
    const c = problemFor(g, { kind: 'offerFit', ref: { kind: 'offer', id: o.id } });
    expect(c).not.toBeNull();
    expect(c!.what).toMatch(/^You can't fly .+ as it stands$|needs care$/);
    expect(c!.why.length).toBeGreaterThan(10);
    expect(c!.actions.length).toBeGreaterThan(0);
    expect(c!.details.length).toBeGreaterThan(0);
    expect(problemAt(g, { kind: 'offer', id: o.id })?.subject.kind).toBe('offerFit');
  });

  it('fleet: a lease ending within 30 days; an uncrewed delivery-style ferry reads as a crew card', () => {
    const g = game();
    const ac = Object.values(g.fleet).find((a) => a.ownership.kind === 'dryLeaseIn')!;
    if (ac.ownership.kind === 'dryLeaseIn') ac.ownership.leaseEnd = g.now + 20 * DAY;
    const l = problemFor(g, { kind: 'leaseReturn', ref: { kind: 'aircraft', id: ac.id } })!;
    expect(l).not.toBeNull();
    expect(l.what).toMatch(/goes back to .+ in 20 days$/);
    expect(l.actions[0].open).toEqual({ modal: 'lease', id: ac.id });
    const b = Object.values(g.fleet)[0];
    const f = addFlight(g, { no: 'AWF1', aircraftId: b.id, contractId: null, kind: 'ferry', from: 'LIS', to: 'SNN', std: g.now + 30 * 60, sta: g.now + 30 * 60 + 150 });
    f.purpose = 'return';
    const c = problemFor(g, { kind: 'ferryUncrewed', ref: { kind: 'flight', id: f.id } });
    if (c) {
      expect(c.what).toMatch(/^The lease-return ferry AWF1 has no /);
      expect(c.terms).toContain('ferry');
    }
  });

  it('postProblem: title = WHAT, body = WHY + HURT, the problem ref and a hurt snapshot', () => {
    const g = game();
    const id = devCrewShortage(g, { hours: 24 });
    const card = problemFor(g, { kind: 'crewShort', ref: { kind: 'flight', id } })!;
    const m = postProblem(g, card, { cat: 'crew' });
    expect(m.title).toBe(card.what);
    expect(m.body.startsWith(card.why)).toBe(true);
    // v0.9 round 4 (§V): the hurt as prose, never the card's 'Yes: ' / 'Not much: ' answer mid-paragraph.
    expect(m.body).toContain(hurtProse(card));
    expect(m.body).not.toMatch(/Yes:|Not much:/);
    expect(m.problem).toEqual(card.subject);
    expect(m.hurt).toEqual({ money: card.hurt.money, pax: card.hurt.pax, delayMin: card.hurt.delayMin, level: card.hurt.level });
    expect(m.tone).toBe(card.severity === 'red' ? 'bad' : 'warn');
    expect(g.messages[0]).toBe(m);
  });

  it('problems(g) is pure and sorted worst first', () => {
    const g = game();
    devCrewShortage(g, { hours: 24 });
    g.company.cash = -100_000;
    const before = JSON.stringify(g);
    const list = problems(g);
    expect(JSON.stringify(g)).toBe(before);
    expect(problems(g)).toBe(list);
    for (let i = 1; i < list.length; i++) expect(list[i - 1].severity === 'red' || list[i].severity === 'amber').toBe(true);
    for (const c of list) {
      expect(c.what.length).toBeGreaterThan(3);
      expect(c.why.length).toBeGreaterThan(3);
      expect(c.hurt.text).toBeTruthy();
      expect(c.actions.length).toBeGreaterThan(0);
    }
  });
});

describe('v0.7.3 restFacility card', () => {
  it('only when 3 pilots on these seats would not do (not on a short day the player gave 4 pilots)', async () => {
    const { devRestPlan } = await import('../dev');
    const { restFacilityCard } = await import('./crew');
    const { setDutyAugment } = await import('../crew');
    const { removeFlights, ownFlightNo } = await import('../core/entities');
    const { touchCrew } = await import('../crew/timeline');
    const { rerosterFrom } = await import('../crew');
    const g = fixtureGame(9);
    const id = devRestPlan(g);
    const f0 = g.flights[id];
    setDutyAugment(g, f0.dutyId!, 2);
    expect(restFacilityCard(g, id)).toBeNull(); // a 13 h day: 3 pilots on business seats would do
    const ac = f0.aircraftId!;
    const std = f0.std;
    removeFlights(g, Object.values(g.flights).filter((x) => x.aircraftId === ac).map((x) => x.id));
    const blk = 14 * 60 + 40;
    const f = addFlight(g, { no: ownFlightNo(g), aircraftId: ac, contractId: null, kind: 'revenue', from: 'LIS', to: 'GRU', std, sta: std + blk, pax: 250 });
    addFlight(g, { no: ownFlightNo(g), aircraftId: ac, contractId: null, kind: 'revenue', from: 'GRU', to: 'LIS', std: std + blk + DAY, sta: std + 2 * blk + DAY, pax: 250 });
    touchCrew(g);
    rerosterFrom(g, ac, g.now);
    expect(restFacilityCard(g, f.id)?.what).toMatch(/needs a 4th pilot/);
  });
});

describe('v0.9 round 4 (§V): the card under Crew Control\'s out-of-hours strip', () => {
  it('drops the name from WHAT and WHY and the limit figure the gauge shows; other cards are untouched', () => {
    const card = { what: 'Mariana Sousa (captain) is out of hours for AWQ105', why: "Mariana's 28-day flying would reach 110:00 (limit 100:00).", title: 'x', hurt: mkHurt({ pax: 100 }) } as unknown as ProblemCard;
    const x = { crewId: 'c1', name: 'Mariana Sousa', role: 'CPT' as const, limit: 'block28d' as const, limitText: 'has reached the 28-day flying limit (100 h)', value: 6600, max: 6000, overMin: 600 };
    const u = cardUnderStrip(card, [x], 'AWQ105');
    expect(u.what).toBe('Out of hours for AWQ105');
    expect(u.why).toBe('28-day flying would reach 110:00.');
    const two = cardUnderStrip({ ...card, why: "Mariana's day would run 17:10 after the 2:40 delay; the limit is 16:00." }, [x, { ...x, crewId: 'c2', name: 'Rui Costa' }], 'AWQ105');
    expect(two.what).toBe('Out of hours for AWQ105 with 1 other');
    expect(two.why).toBe('Day would run 17:10 after the 2:40 delay.');
    expect(cardUnderStrip(card, [], 'AWQ105')).toBe(card);
  });
});
