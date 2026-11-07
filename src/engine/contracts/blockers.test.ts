// v0.18 reasons an offer can't be taken, most important first (contracts/blockers.ts), and the haul/body shape
// (contracts/shape.ts) the cards and the filter read.
import { describe, expect, it } from 'vitest';
import { acceptOffer, feasibilityAll } from '.';
import { legsOffer, newGame } from './testkit';
import { DAY, HOUR, dayStart } from '../core/time';
import { offerFitCard } from '../problems/commercial';
import { bestByRank, blockTier, checkRank, offerVerdict, reasonText, sortChecks, topBlocker } from './blockers';
import type { FeasibilityCheck, FeasibilityReport } from './feasibility';
import { bodyOfReq, haulOfMin, shapeOf, typicalBlockMin } from './shape';
import { offerHidden, setOfferFilter } from './filter';

const chk = (id: FeasibilityCheck['id'], level: FeasibilityCheck['level'], label: string, action?: FeasibilityCheck['action']): FeasibilityCheck => ({ id, level, label, ...(action ? { action } : {}) });
const rep = (aircraftId: string, checks: FeasibilityCheck[], estMargin = 0): FeasibilityReport => ({
  offerId: 'o', aircraftId, level: checks.some((c) => c.level === 'no') ? 'no' : checks.some((c) => c.level === 'warn') ? 'warn' : 'ok', checks,
  positionIn: [], positionOut: [], techStops: [], conflicts: { flights: [], maintenance: [], programmes: [] },
  crew: { setsNeeded: 0, setsAvailable: 0, byRole: {}, firstShort: null }, estBH: 0, estRevenue: 0, estCost: 0, estMargin,
});

describe('v0.18 blocker tiers', () => {
  it('an approval we lack, the wrong body or range are impossible; a refit is work; busy flights are solvable', () => {
    expect(blockTier(chk('approvals', 'no', 'Needs approval: IOSA registration'))).toBe(0);
    expect(blockTier(chk('body', 'no', 'CS-TQA is an A320: the client wants a widebody'))).toBe(0);
    expect(blockTier(chk('range', 'no', 'LIS–NRT is beyond the A320\'s reach'))).toBe(0);
    expect(blockTier(chk('etops', 'no', 'Routing needs ETOPS 180: we hold no ETOPS approval'))).toBe(0);
    expect(blockTier(chk('positioning', 'no', "Can't get there in time: earliest arrival"))).toBe(0);
    expect(blockTier(chk('layout', 'no', 'Needs a two-class cabin', { kind: 'refit', layout: 'two-class' }))).toBe(1);
    expect(blockTier(chk('layout', 'no', 'Needs a VIP cabin'))).toBe(0);
    expect(blockTier(chk('maintenance', 'no', 'C-check due 3 Mar, inside the job'))).toBe(1);
    expect(blockTier(chk('paint', 'no', 'No paint-shop slot: 5 days'))).toBe(1);
    expect(blockTier(chk('availability', 'no', 'Busy: BLU101 LIS–FAO 3 Mar'))).toBe(2);
    expect(blockTier(chk('availability', 'no', "Can't be back for BLU102"))).toBe(2);
    expect(blockTier(chk('positioning', 'no', 'Not planned: the aircraft is busy'))).toBe(2);
    expect(blockTier(chk('availability', 'no', 'Sold: goes to X on 3 Mar'))).toBe(0);
    expect(checkRank(chk('crew', 'warn', 'Short of crew: 2 FO'))).toBe(3);
    expect(checkRank(chk('seats', 'ok', '180 seats'))).toBe(4);
  });

  it('sorts impossible before work before busy before warnings, keeping the feasibility order inside a tier', () => {
    const checks = [
      chk('seats', 'ok', '180 seats'),
      chk('availability', 'no', 'Busy: BLU101 LIS–FAO 3 Mar'),
      chk('layout', 'no', 'Needs a two-class cabin', { kind: 'refit', layout: 'two-class' }),
      chk('crew', 'warn', 'Short of crew: 2 FO'),
      chk('approvals', 'no', 'Needs approval: IOSA registration'),
      chk('runway', 'no', 'FNC runway 1,800 m'),
    ];
    expect(sortChecks(checks).map((c) => c.id)).toEqual(['approvals', 'runway', 'layout', 'availability', 'crew', 'seats']);
    expect(topBlocker(rep('a', checks))!.id).toBe('approvals');
  });

  it('leads with the aircraft closest to taking the job: busy beats needs-a-refit beats impossible', () => {
    const imp = rep('imp', [chk('body', 'no', 'wrong body')], 900);
    const work = rep('work', [chk('layout', 'no', 'Needs a two-class cabin', { kind: 'refit', layout: 'two-class' })], 800);
    const busy = rep('busy', [chk('availability', 'no', 'Busy: BLU101')], 100);
    expect(bestByRank([imp, work, busy])!.aircraftId).toBe('busy');
    expect(bestByRank([imp, work])!.aircraftId).toBe('work');
    expect(bestByRank([imp, work, busy, rep('fine', [chk('seats', 'ok', 'ok')], -5)])!.aircraftId).toBe('fine');
  });

  it('the headline names the top blocker in plain words, the rest folded beneath', () => {
    const g = newGame();
    const r = rep(Object.keys(g.fleet)[0], [
      chk('availability', 'no', 'Busy: BLU101 LIS–FAO 3 Mar'),
      chk('approvals', 'no', 'Needs approval: IOSA registration'),
    ]);
    const v = offerVerdict(g, [r])!;
    expect(v.rank).toBe(0);
    expect(v.headline).toBe('Not possible: needs IOSA registration (we have none)');
    expect(v.more.map((m) => m.check.id)).toEqual(['availability']);
    const busy = offerVerdict(g, [rep(r.aircraftId, [chk('availability', 'no', 'Busy: BLU101 LIS–FAO 3 Mar')])])!;
    expect(busy.rank).toBe(2);
    expect(busy.headline).toBe(`Flights in the way on ${g.fleet[r.aircraftId].reg}: BLU101 LIS–FAO 3 Mar`);
    // Booked by a programme with no flights yet: nothing to move, so it needs work.
    const prog = rep(r.aircraftId, [chk('availability', 'no', 'Busy: Summer base at Faro (1 Jun–30 Sep)')]);
    prog.conflicts.programmes.push('k1');
    expect(offerVerdict(g, [prog])!.headline).toMatch(/^Booked for other work on /);
    expect(offerVerdict(g, [prog])!.rank).toBe(1);
    g.company.pendingApprovals.push({ id: 'iosa', done: g.now + 100 * DAY } as never);
    expect(reasonText(g, chk('approvals', 'no', 'Needs approval: IOSA registration'))).toMatch(/^needs IOSA registration \(filed, due /);
  });
});

describe('v0.18 a real offer: IOSA first, flights in the way solvable', () => {
  it('an offer asking for IOSA on a busy aircraft leads with IOSA, and without the ask with the busy flights', () => {
    const g = newGame();
    const ac = Object.values(g.fleet).find((a) => a.status !== 'delivering')!;
    const t = dayStart(g.now) + 12 * DAY + 8 * HOUR;
    for (const id of Object.keys(g.fleet)) {
      const busy = legsOffer(g, [['LIS', 'FAO', t], ['FAO', 'LIS', t + 3 * HOUR]], 150);
      const res = acceptOffer(g, busy.id, [id]);
      if (!res.ok) continue;
    }
    const o = legsOffer(g, [['LIS', 'FAO', t + 30], ['FAO', 'LIS', t + 3 * HOUR + 30]], 150);
    const plain = offerVerdict(g, feasibilityAll(g, o.id))!;
    expect(plain.rank).toBe(2);
    o.requirements.approvals = ['iosa'];
    const v = offerVerdict(g, feasibilityAll(g, o.id))!;
    expect(v.rank).toBe(0);
    expect(v.headline).toBe('Not possible: needs IOSA registration (we have none)');
    expect(v.more.some((m) => m.rank === 2)).toBe(true);
    // The four-line card elsewhere leads with the same reason.
    expect(offerFitCard(g, o.id)!.why).toMatch(/^Needs IOSA registration \(we have none\)/);
    expect(ac).toBeTruthy();
  });
});

describe('v0.18 offer shape: body and haul', () => {
  it('bands the typical block time: short < 3 h, medium < 6 h, long < 12 h, ultra-long beyond', () => {
    expect(haulOfMin(typicalBlockMin(900))).toBe('short'); // LIS–FRA ~1,000 nm is ~2:40
    expect(haulOfMin(typicalBlockMin(2100))).toBe('medium'); // LIS–TLV
    expect(haulOfMin(typicalBlockMin(4300))).toBe('long'); // LIS–GRU
    expect(haulOfMin(typicalBlockMin(5900))).toBe('ultra'); // LHR–SIN
  });

  it('reads the longest revenue sector and the body the job needs', () => {
    const g = newGame();
    const t = dayStart(g.now) + 20 * DAY;
    const short = legsOffer(g, [['LIS', 'FAO', t], ['FAO', 'LIS', t + 3 * HOUR]]);
    expect(shapeOf(short)).toMatchObject({ body: 'narrow', haul: 'short' });
    const gru = legsOffer(g, [['LIS', 'FAO', t], ['LIS', 'GRU', t + DAY]], 280);
    const s = shapeOf(gru);
    expect(s).toMatchObject({ body: 'wide', haul: 'long', sector: ['LIS', 'GRU'] });
    expect(bodyOfReq({ minSeats: 150, body: 'wide' })).toBe('wide');
    expect(bodyOfReq({ minSeats: 150, families: ['A330/340'] })).toBe('wide');
    expect(bodyOfReq({ minSeats: 150, families: ['A320'] })).toBe('narrow');
  });

  it('the filter hides by body and haul, a dry lease out never by haul', () => {
    const g = newGame();
    const t = dayStart(g.now) + 20 * DAY;
    const short = legsOffer(g, [['LIS', 'FAO', t], ['FAO', 'LIS', t + 3 * HOUR]]);
    const gru = legsOffer(g, [['LIS', 'GRU', t]], 280);
    setOfferFilter(g, { on: true, hauls: ['long', 'ultra'] });
    expect(offerHidden(g, short)).toBe(true);
    expect(offerHidden(g, gru)).toBe(false);
    setOfferFilter(g, { hauls: [], bodies: ['narrow'] });
    expect(offerHidden(g, short)).toBe(false);
    expect(offerHidden(g, gru)).toBe(true);
    expect(g.filter!.hauls).toBeUndefined();
    setOfferFilter(g, { bodies: [], hauls: ['ultra'] });
    const dry = { ...short, id: 'dry1', product: { kind: 'dry', rentPerMonth: 1, reservesPerFH: 1 } } as typeof short;
    expect(offerHidden(g, dry)).toBe(false);
  });
});
