import { describe, expect, it } from 'vitest';
import { newGame } from '../../engine/contracts/testkit';
import { DAY, HOUR } from '../../engine/core/time';
import type { ContractOffer, CrewMember, MonthStatement } from '../../engine/core/types';
import {
  counterSteps, expiryLabel, filterCrew, filterMessages, limitTone, marketOffers, NO_FILTER, productLine, refTarget, reqChips, riskChips, routeSummary, spanLabel,
  statementView,
} from './screenLogic';

const offer = (id: string, urgency: ContractOffer['urgency'], estValue: number, status: ContractOffer['status'] = 'open') =>
  ({ id, urgency, estValue, status, expires: 1000 }) as ContractOffer;

describe('contracts helpers', () => {
  it('orders the market urgent first, then by value; closed offers stay out', () => {
    const g = newGame();
    g.offers = { a: offer('a', 'normal', 900), b: offer('b', 'urgent', 100), c: offer('c', 'short', 500), d: offer('d', 'urgent', 5000, 'lost'), e: offer('e', 'normal', 2000, 'countered') };
    expect(marketOffers(g).map((o) => o.id)).toEqual(['b', 'c', 'e', 'a']);
  });
  it('counts expiry down in whole game hours', () => {
    expect(expiryLabel(0, 30 * HOUR + 59)).toBe('30 h left');
    expect(expiryLabel(0, 3 * DAY + 5 * HOUR + 10)).toBe('3 d 5 h left');
    expect(expiryLabel(0, 40)).toBe('40 min left');
    expect(expiryLabel(10, 5)).toBe('Expired');
    expect(spanLabel(2 * DAY)).toBe('2 d');
  });
  it('summarises routes and products', () => {
    expect(routeSummary({ kind: 'legs', legs: [{ from: 'LIS', to: 'OLB', dep: 0, flightNo: '', pax: 1 }, { from: 'OLB', to: 'LIS', dep: 5, flightNo: '', pax: 1 }] })).toBe('LIS ⇄ OLB');
    expect(routeSummary({ kind: 'legs', legs: [{ from: 'KBL', to: 'TBS', dep: 0, flightNo: '', pax: 1 }, { from: 'TBS', to: 'LIS', dep: 5, flightNo: '', pax: 1 }] })).toBe('KBL → TBS → LIS');
    expect(productLine({ kind: 'charter', price: 412_000 } as never)).toBe('$412K charter');
    expect(productLine({ kind: 'wet', ratePerBH: 3950, mghPerMonth: 200 } as never)).toBe('$3,950/BH · MGH 200');
  });
  it('shows risk chips from 0.35 and requirement chips for ETOPS', () => {
    expect(riskChips({ payment: 0.7, disruption: 0.2, politics: 0.4, permit: 0 }).map((c) => [c.label, c.tone])).toEqual([['Late payer', 'bad'], ['Politics', 'warn']]);
    const req = reqChips({ minSeats: 150, longestSectorNm: 900, approvals: [], etops: 120 } as never);
    expect(req.map((c) => c.label)).toEqual(['150+ seats', 'ETOPS 120']);
  });
  it('steps counters by 2.5% up to +20%, rounded', () => {
    const s = counterSteps(3950, true);
    expect(s).toHaveLength(8);
    expect(s[0]).toBe(4050);
    expect(s[7]).toBe(4740);
    expect(counterSteps(412_000, false)[1]).toBe(433_000);
  });
});

describe('crew helpers', () => {
  const c = (id: string, role: CrewMember['role'], last: string, extra: Partial<CrewMember> = {}) =>
    ({ id, role, first: 'A', last, status: 'available', ratings: ['A320'], loc: 'LIS', base: 'LIS', nationality: 'PT', ...extra }) as CrewMember;
  const list = [c('1', 'CC', 'Silva'), c('2', 'CPT', 'Zeta'), c('3', 'FO', 'Alves', { status: 'onDuty', loc: 'HAM' }), c('4', 'CPT', 'Bento')];
  it('sorts by role then surname and filters by group, status, place and search', () => {
    expect(filterCrew(list, NO_FILTER).map((x) => x.id)).toEqual(['4', '2', '3', '1']);
    expect(filterCrew(list, { ...NO_FILTER, group: 'cabin' }).map((x) => x.id)).toEqual(['1']);
    expect(filterCrew(list, { ...NO_FILTER, status: 'away' }).map((x) => x.id)).toEqual(['3']);
    expect(filterCrew(list, { ...NO_FILTER, q: 'ham' }).map((x) => x.id)).toEqual(['3']);
    expect(filterCrew(list, { ...NO_FILTER, rating: 'B737' })).toEqual([]);
  });
  it('colours limit bars green / amber / red', () => {
    expect([0.5, 0.8, 0.97].map(limitTone)).toEqual(['good', 'warn', 'bad']);
  });
});

describe('finance and inbox helpers', () => {
  it('builds statement columns (current first) and only the lines in use', () => {
    const st = (month: number, lines: MonthStatement['lines']): MonthStatement => ({ month, lines, bh: 0, cashStart: 0, cashEnd: 0, closed: true });
    const cur = st(5, { acmiRevenue: 1000, fuel: -300 });
    const v = statementView(cur, [st(3, { rent: -50 }), st(4, { acmiRevenue: 800 }), cur], 5);
    expect(v.months.map((m) => m.month)).toEqual([5, 4, 3]);
    expect(v.rows.map((r) => r.cat)).toEqual(['acmiRevenue', 'fuel', 'rent']);
    expect(v.rows[0].values).toEqual([1000, 800, 0]);
  });
  it('filters messages and resolves deep links', () => {
    const g = newGame();
    const ac = Object.values(g.fleet)[0];
    const crew = Object.values(g.crew)[0];
    expect(refTarget(g, { kind: 'aircraft', id: ac.id })).toEqual({ tab: 'fleet', sel: { kind: 'aircraft', id: ac.id } });
    expect(refTarget(g, { kind: 'crew', id: crew.id })).toEqual({ tab: 'crew', sel: { kind: 'crew', id: crew.id } });
    expect(refTarget(g, { kind: 'offer', id: 'gone' })).toEqual({ tab: 'contracts', view: 'missed' });
    const open = Object.values(g.offers).find((o) => o.status === 'open');
    if (open) expect(refTarget(g, { kind: 'offer', id: open.id })?.offerId).toBe(open.id);
    expect(filterMessages(g.messages, 'goal').every((m) => m.cat === 'goal')).toBe(true);
  });
});

describe('v0.7 conversion confirm (C1)', () => {
  it('asks for a confirm exactly when a red warning exists', async () => {
    const { needsConfirm } = await import('./screenLogic');
    expect(needsConfirm({ warnings: [] })).toBe(false);
    expect(needsConfirm({ warnings: [{ level: 'warn' }] })).toBe(false);
    expect(needsConfirm({ warnings: [{ level: 'warn' }, { level: 'bad' }] })).toBe(true);
  });
});

describe('v0.7 market, cabin and inbox helpers', () => {
  it('labels market offers and routes market refs to Fleet → Market', async () => {
    const { offerKind, sellerOf, refTarget: rt } = await import('./screenLogic');
    expect(offerKind({ kind: 'dryLeaseIn', newBuild: true }).label).toBe('New-build lease');
    expect(offerKind({ kind: 'dryLeaseIn' }).label).toBe('Lease used');
    expect(offerKind({ kind: 'buy' }).label).toBe('Buy used');
    expect(sellerOf({ lessor: 'BOC Aviation (used sale)' })).toBe('BOC Aviation');
    expect(rt(newGame(), { kind: 'market', id: 'mo1' })).toEqual({ tab: 'fleet', view: 'market', sel: { kind: 'market', id: 'mo1' } });
  });
  it('filters market alerts by topic', () => {
    const ms = [{ id: 'a', cat: 'company', topic: 'market' }, { id: 'b', cat: 'company' }] as never[];
    expect(filterMessages(ms, 'market').map((m: { id: string }) => m.id)).toEqual(['a']);
    expect(filterMessages(ms, 'company')).toHaveLength(2);
  });
  it('keeps only live problems and recent bad news under Problems only', async () => {
    const { isOpportunity, showLossMonth } = await import('./screenLogic');
    const g = newGame();
    const ms = [
      { id: 'a', cat: 'commercial', tone: 'warn', t: g.now, ref: { kind: 'offer', id: 'gone' }, problem: { kind: 'offerFit', ref: { kind: 'offer', id: 'gone' } }, hurt: { money: 199_000, pax: 0, delayMin: 0, level: 'high' } },
      { id: 'b', cat: 'ops', tone: 'bad', t: g.now - DAY },
      { id: 'c', cat: 'ops', tone: 'bad', t: g.now - 9 * DAY },
      { id: 'd', cat: 'finance', tone: 'info', t: g.now },
    ] as never[];
    expect(filterMessages(ms, 'problems', g).map((m: { id: string }) => m.id)).toEqual(['b']);
    expect(isOpportunity(ms[0])).toBe(true);
    expect(isOpportunity(ms[1])).toBe(false);
    expect(typeof showLossMonth(g)).toBe('boolean');
  });
  it('shows cabin requirement chips', () => {
    const base = { minSeats: 100, approvals: [], longestSectorNm: 500 } as never as Parameters<typeof reqChips>[0];
    expect(reqChips({ ...base, layouts: ['vip'] }).map((c) => c.label)).toContain('VIP cabin');
    expect(reqChips({ ...base, layouts: ['two-class', 'three-class', 'vip'], minPremium: 20 }).map((c) => c.label)).toEqual(expect.arrayContaining(['Premium cabin', 'Premium 20+']));
    expect(reqChips({ ...base, minSeats: 180, layouts: ['all-economy'] }).map((c) => c.label)).toContain('Max seats 180+');
  });
});
