// v0.17 lane market-ui: the pure wording behind Fleet › Market (marketLogic.ts).
import { describe, expect, it } from 'vitest';
import { DAY, fromUTC } from '../../../engine/core/time';
import type { AircraftOffer, Rfp, RfpAnswer } from '../../../engine/core/types';
import { answerChip, dealLine, depositMonthsOf, offerDaysLeft, offerMatches, offerReadyLine, offerTermsLine, ratingLine, ratingParts, rfpStatus, rfpTitle, rfpsShown, sourceBadge, spotLine, stageChips, transitionLine } from './marketLogic';

const now = fromUTC(2027, 3, 1);
const lease = { kind: 'dryLeaseIn' as const, rentPerMonth: 287_000, leaseMonths: 36, deposit: 574_000, price: 0 };

describe('offer cards (§N.2)', () => {
  it('badges by source; legacy offers keep their words', () => {
    expect(sourceBadge({ kind: 'dryLeaseIn', source: 'proposal' }).label).toBe('Proposal');
    expect(sourceBadge({ kind: 'dryLeaseIn', source: 'proposal', later: true }).label).toBe('Proposal · later');
    expect(sourceBadge({ kind: 'dryLeaseIn', source: 'call' }).label).toBe('Lessor call');
    expect(sourceBadge({ kind: 'dryLeaseIn', source: 'spot' }).label).toBe('Short-term');
    expect(sourceBadge({ kind: 'buy', source: 'batch' }).label).toBe('Batch · for sale');
    expect(sourceBadge({ kind: 'dryLeaseIn' }).label).toBe('Lease used');
    expect(sourceBadge({ kind: 'dryLeaseIn', newBuild: true }).label).toBe('New-build lease');
  });
  it('terms line with the deposit in months', () => {
    expect(offerTermsLine(lease)).toBe('$287K/month · 36 months · deposit 2 months ($574K)');
    expect(offerTermsLine({ ...lease, depositMonths: 3 })).toBe('$287K/month · 36 months · deposit 3 months ($574K)');
    expect(offerTermsLine({ ...lease, kind: 'buy', price: 38_500_000 })).toBe('Price $38.5M');
    expect(depositMonthsOf({ deposit: 220_000, rentPerMonth: 220_000 })).toBe(1);
  });
  it('ready line: stored aircraft at the site, flying ones with their airline', () => {
    expect(offerReadyLine(now, { site: 'SNN' }, now + 30 * DAY, now + 32 * DAY)).toMatch(/^Ready ~31 Mar at Shannon · home ~2 Apr$/);
    expect(offerReadyLine(now, { site: 'SNN', freeAt: now + 60 * DAY, exOperator: 'Air Europa' }, now + 90 * DAY, null)).toMatch(/^With Air Europa until 30 Apr · ready ~30 May$/);
  });
  it('filters and days left', () => {
    expect(offerMatches({ typeId: 'a332' }, 'wide', false)).toBe(true);
    expect(offerMatches({ typeId: 'a332' }, 'narrow', false)).toBe(false);
    expect(offerMatches({ typeId: 'a320ceo', source: 'spot' }, 'spot', false)).toBe(true);
    expect(offerMatches({ typeId: 'a320ceo' }, 'bunks', true)).toBe(true);
    expect(offerDaysLeft(now, { expires: now + 6 * DAY - 10, validUntil: undefined } as Pick<AircraftOffer, 'expires' | 'validUntil'>)).toBe(6);
  });
});

describe('rating line (§N.1)', () => {
  it('words and parts', () => {
    expect(ratingLine({ grade: 'C' }, 3)).toBe('Lessor rating C · start-up · deposit 3 months');
    expect(ratingLine({ grade: 'A' }, 1)).toBe('Lessor rating A · strong · deposit 1 month');
    const p = ratingParts({ score: 54, parts: [{ label: 'a', pts: 0 }, { label: 'cash', pts: -25 }, { label: 'cover', pts: 14 }] });
    expect(p.map((x) => x.pts)).toEqual(['−25', '+14', '0']);
    expect(p[0].tone).toBe('bad');
  });
});

describe('requests (§N.1)', () => {
  const a = (x: Partial<RfpAnswer>): RfpAnswer => ({ lessorId: 'aercap', due: now + 10 * DAY, ...x });
  it('answer chips', () => {
    expect(answerChip(now, a({})).text).toBe('AerCap: by 11 Mar');
    expect(answerChip(now, a({ at: now, kind: 'proposal', offerIds: ['m1'] })).text).toBe('AerCap ✓ proposal');
    expect(answerChip(now, a({ lessorId: 'avolon', at: now, kind: 'none' })).text).toBe('Avolon: no aircraft');
    expect(answerChip(now, a({ lessorId: 'carlyle', at: now, kind: 'credit', text: 'We need rating B' }))).toMatchObject({ text: 'Carlyle Aviation Partners: rating', tone: 'warn', tip: 'We need rating B' });
    expect(answerChip(now, a({ lessorId: 'exop', at: now, kind: 'proposal' }), 'b743').text).toBe('Owners in storage ✓ proposal');
  });
  const r: Rfp = { id: 'r1', typeId: 'a332', band: 'mid', months: 36, count: 1, from: now + 92 * DAY, asap: false, flex: true, sent: now, replyBy: now + 20 * DAY, answers: [a({ at: now, kind: 'proposal', offerIds: ['m1'] }), a({ lessorId: 'avolon' })], status: 'open' };
  it('title and status', () => {
    expect(rfpTitle(now, r)).toBe('A330-200 · mid-life · 36 months · from 1 Jun (± a month)');
    expect(rfpStatus(now, r)).toBe('Answers by 21 Mar · 1 of 2 in · 1 proposal');
    expect(rfpStatus(now, { ...r, status: 'done' })).toBe('Answered: 1 proposal');
    expect(rfpTitle(now, { ...r, asap: true, count: 2 })).toBe('A330-200 · mid-life · 36 months · as soon as possible · 2 aircraft');
  });
  it('open first, old ones dropped', () => {
    const old = { ...r, id: 'r0', status: 'done' as const, sent: now - 90 * DAY };
    const done = { ...r, id: 'r2', status: 'done' as const, sent: now - 5 * DAY };
    expect(rfpsShown(now, [old, done, r]).map((x) => x.id)).toEqual(['r1', 'r2']);
  });
});

describe('in progress (§N.1)', () => {
  it('stage chips', () => {
    const c = stageChips('credit');
    expect(c.map((x) => x.label)).toEqual(['LOI ✓', 'Credit check', 'Lease', 'Transition', 'Ferry']);
    expect(c[1].state).toBe('now');
    expect(stageChips('credit', true)[1].state).toBe('bad');
  });
  it('deal lines', () => {
    expect(dealLine(now, { stage: 'committee', committeeAt: now + 14 * DAY, holding: 1 }).text).toBe('Credit check · answer by 15 Mar');
    expect(dealLine(now, { stage: 'approved', committeeAt: now, signBy: now + 7 * DAY, holding: 1 })).toMatchObject({ at: 'lease', tone: 'warn' });
    expect(dealLine(now, { stage: 'declined', committeeAt: now, why: 'Rating fell from B to D', holding: 1 }).text).toBe('Declined: Rating fell from B to D · holding deposit back');
  });
  it('transition and short-term lines', () => {
    const ind = { slot: now, records: [now, now + 20 * DAY], check: [now + 10 * DAY, now + 20 * DAY], reg: [now, now], ready: now + 30 * DAY, waitedCamo: 0, waitedFree: 0 } as const;
    expect(transitionLine({ induction: { ...ind, records: [...ind.records], check: [...ind.check], reg: [...ind.reg] }, at: 'SNN', delivery: undefined }, 'check')).toBe('Transition at Shannon: transition check · ready 31 Mar (UTC)');
    // Late UTC evening at Shannon in summer time: the local day is the next.
    const late = fromUTC(2027, 6, 14) + 23 * 60 + 30;
    expect(transitionLine({ induction: { ...ind, records: [...ind.records], check: [...ind.check], reg: [...ind.reg], ready: late }, at: 'SNN', delivery: undefined }, 'paint')).toBe('Transition at Shannon: paint · ready 14 Jun (UTC) · 15 Jun local');
    expect(spotLine({ ownership: { kind: 'dryLeaseIn', lessor: 'TUI fly', rentPerMonth: 1, reservesPerFH: 1, leaseStart: now, leaseEnd: fromUTC(2027, 3, 31), deposit: 1, spot: { airline: 'TUI fly', base: 'FRA' } } as never })).toBe('Back to TUI fly 31 Mar');
  });
});

describe('request dialog type list (§D.1, §T)', () => {
  it('lists the fleet types, the request-only A320neo and every rare type; hides far-off common types', async () => {
    const { createGame } = await import('../../../engine/newGame');
    const { rfpTypes } = await import('./marketLogic');
    const g = createGame({ name: 'Atlântica Wings', code: 'AW', livery: { primary: '#0b1f4d', secondary: '#f5c451', tail: 'sweep' }, base: 'LIS', seed: 7 });
    const ids = rfpTypes(g).map((x) => x.t.id);
    for (const id of ['a320ceo', 'a320neo', 'a388', 'b744', 'b748', 'a345', 'b743']) expect(ids).toContain(id);
    // Tier 4 is three approvals away at the start: not listed (not rare).
    expect(ids).not.toContain('a359');
    const a388 = rfpTypes(g).find((x) => x.t.id === 'a388')!;
    expect(a388.ok).toBe(false);
    expect(a388.note).toMatch(/Needs .* first/);
  });
});
