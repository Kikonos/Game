// v0.17 lease returns (UPDATE-0.17.md §E.5, §E.6, §E.3): the half-life share and lighter check of an old lease, the
// extension rent from tightness, the reserves deposit back; legacy leases unchanged.

import { describe, expect, it } from 'vitest';
import { ACMI_TYPES } from '../../data/acmiTypes';
import { BAL } from '../core/balance';
import { DAY } from '../core/time';
import { leased, newGame } from '../contracts/testkit';
import { acquireAircraft, makeOffer } from './market';
import { leaseView, returnQuote } from './leaseReturn';

const own = (ac: ReturnType<typeof leased>) => ac.ownership as Extract<typeof ac.ownership, { kind: 'dryLeaseIn' }>;

describe('v0.17 lease returns', () => {
  it('a legacy lease keeps the 0.5 half-life share and the full check', () => {
    const g = newGame(3);
    const ac = leased(g);
    expect(own(ac).halfLifeShare).toBeUndefined();
    expect(returnQuote(g, ac.id)!.lines[0].amount).toBe(BAL.leaseReturn.checkCost[0]);
  });

  it('an old v0.17 lease: half-life 0.25 and the return check × 0.6; a young one 0.6', () => {
    const g = newGame(4);
    g.company.cash = 60_000_000;
    const o = makeOffer(g, ACMI_TYPES.a320ceo, { source: 'call', lessorId: 'vallair', band: 'old' });
    g.market.aircraft.push(o);
    const r = acquireAircraft(g, o.id, { direct: true });
    expect(r.ok).toBe(true);
    const ac = g.fleet[(r as { data: { aircraftId: string } }).data.aircraftId];
    expect(own(ac).halfLifeShare).toBe(0.25);
    expect(own(ac).lessorId).toBe('vallair');
    expect(own(ac).minFH).toBe(80);
    expect(own(ac).reservesEscAt).toBeGreaterThan(ac.delivery!.handover);
    expect(returnQuote(g, ac.id)!.lines[0].amount).toBe(Math.round((BAL.leaseReturn.checkCost[0] * 0.6) / 1000) * 1000);
  });

  it('the extension rent follows tightness: a tight type extends above today\'s rent, an easy one below', () => {
    const g = newGame(5);
    const ac = leased(g);
    own(ac).index = g.market.narrowIndex;
    g.leasing!.tight[ac.typeId] = 0.9;
    const tight = leaseView(g, ac.id)!.options[0].rent!;
    g.leasing!.tight[ac.typeId] = 0.1;
    const easy = leaseView(g, ac.id)!.options[0].rent!;
    expect(tight).toBeGreaterThan(easy);
    expect(tight).toBeGreaterThanOrEqual(own(ac).rentPerMonth);
    (BAL.v017 as { on: boolean }).on = false;
    try {
      expect(leaseView(g, ac.id)!.options[0].rent).toBe(Math.max(ACMI_TYPES[ac.typeId].rentFloor ?? 0, Math.round((own(ac).rentPerMonth * 0.97) / 1000) * 1000));
    } finally {
      (BAL.v017 as { on: boolean }).on = true;
    }
  });

  it('grade D: the reserves deposit is paid at signing', () => {
    const g = newGame(6);
    g.leasing!.credit = { score: 30, grade: 'D', parts: [], at: g.now + DAY };
    g.company.cash = 60_000_000;
    const o = makeOffer(g, ACMI_TYPES.a320ceo, { source: 'call', lessorId: 'vallair', band: 'old', grade: 'D' });
    expect(o.reservesDeposit).toBeGreaterThan(0);
    g.market.aircraft.push(o);
    const cash = g.company.cash;
    const r = acquireAircraft(g, o.id, { direct: true });
    expect(r.ok).toBe(true);
    const ac = g.fleet[(r as { data: { aircraftId: string } }).data.aircraftId];
    expect(own(ac).reservesDeposit).toBe(o.reservesDeposit);
    expect(cash - g.company.cash).toBe(o.deposit + o.reservesDeposit! + (o.transition ?? 0));
  });
});
