// v0.7.4 client cabin requests: on the offer like client paint, a quick reconfiguration before the start booked at
// signing, the client's share invoiced when the work ends, optional requests declined for a rate cut, and the cabin
// put back after the contract (at the client's expense when it ran its course).

import { describe, expect, it } from 'vitest';
import { BAL } from '../core/balance';
import { DAY } from '../core/time';
import { acceptOffer, feasibility } from '.';
import { askingPrice } from './accept';
import { ACMI_TYPES_LIST } from '../../data/acmiTypes';
import { complement } from '../core/perf';
import type { Archetype } from '../core/types';
import { cabinQuote, cabinTarget, cabinTermsText, CABIN_REQUEST_KINDS, termsProduct } from './cabinTerms';
import { clientCrewOnCabin, devDryLease } from './missions';
import { generateOffer } from './offers';
import { newGame, offer, owned, run } from './testkit';

/** A narrowbody season base (seats the A320 meets either way) whose client wants this cabin. */
const base = (g: ReturnType<typeof newGame>, force: { layout: 'two-class' | 'all-economy'; required?: boolean; share?: number; revert?: boolean }) => {
  const o = offer(g, 'seasonBase', { start: g.now + 20 * DAY, days: 30, cabin: force });
  o.requirements.minSeats = 160;
  o.cabin = { layout: force.layout, required: force.required ?? true, declinePct: 0.03, clientShare: force.share ?? 1, cost: force.layout === 'two-class' ? 40_000 : 30_000, days: 2, revert: force.revert ?? true };
  return o;
};

describe('client cabin requests (v0.7.4)', () => {
  it('rolled on long work only, within the cabins the work accepts, never on premium work; plain words on the offer', async () => {
    const { generateOffer } = await import('./offers');
    const g = newGame(21);
    let n = 0;
    for (let i = 0; i < 150; i++) {
      const o = generateOffer(g, undefined, { window: false });
      if (!o?.cabin) continue;
      n++;
      expect(['seasonBase', 'capacityLease', 'tourSeries']).toContain(o.archetype);
      expect(o.requirements.minPremium).toBeUndefined();
      if (o.requirements.layouts) expect(o.requirements.layouts).toContain(o.cabin.layout);
      expect(o.cabin.days).toBe(2);
      expect([1, 0.5]).toContain(o.cabin.clientShare);
      expect(o.blurb).toContain('They want ');
    }
    expect(n).toBeGreaterThan(0);
    expect(cabinTermsText({ layout: 'two-class', required: true, declinePct: 0.03, clientShare: 1, cost: 40_000, days: 2, revert: true }, 'a320ceo'))
      .toBe('They want a two-class cabin (business and economy) (12J/156Y on the A320) for the contract: a quick 48 h reconfiguration in our hangar before it starts (a condition of the deal); they pay for it and for putting it back after.');
  });

  it('feasibility: the reconfiguration window before the start, seats as after it, the cost our share only', () => {
    const g = newGame(22);
    const ac = owned(g);
    const o = base(g, { layout: 'two-class', share: 0.5, revert: true });
    const rep = feasibility(g, o.id, ac.id);
    const c = rep.checks.find((x) => x.id === 'cabinReq')!;
    expect(c.level).toBe('ok');
    expect(c.label).toMatch(/^Client cabin: quick reconfiguration to 12J\/156Y, .+ \(client pays half, \$40K \+ \$30K to put back\)$/);
    expect(rep.cabinSlot?.label).toBe('12J/156Y');
    expect(rep.checks.find((x) => x.id === 'seats')!.label).toMatch(/^168 seats after the client’s reconfiguration/);
    const q = cabinQuote(o.cabin!, ac.typeId, 'all-economy');
    expect(q).toMatchObject({ cost: 40_000, back: 30_000, reimbursed: 35_000, days: 2, label: '12J/156Y' });
    // already two-class: nothing to change, nothing to pay
    ac.cabin = { j: 12, w: 0, y: 156, total: 168, label: '12J/156Y', layout: 'two-class' };
    expect(feasibility(g, o.id, ac.id).checks.find((x) => x.id === 'cabinReq')!.label).toBe(`Client cabin: ${ac.reg} is already 12J/156Y, nothing to change`);
  });

  it('signing books the 48 h reconfiguration before the start; the client is invoiced its share; put back after the contract at its expense', () => {
    const g = newGame(23);
    const ac = owned(g);
    const o = base(g, { layout: 'two-class', share: 1, revert: true });
    const r = acceptOffer(g, o.id, [ac.id]);
    if (!r.ok) throw new Error(r.error);
    const c = g.contracts[r.data!.contractId];
    expect(c.cabin).toMatchObject({ accepted: true, layout: 'two-class', from: { [ac.id]: '180Y' } });
    expect(c.requirements.layouts).toEqual(['two-class']);
    const m = g.maintenance[c.cabin!.inMx![ac.id]];
    expect(m).toMatchObject({ kind: 'refit', cost: 40_000, clientCabin: { contractId: c.id, phase: 'in' } });
    expect(m.end - m.start).toBe(2 * DAY);
    expect(m.end).toBeLessThanOrEqual(c.start - BAL.clientCabin.readyBefore);
    const inv0 = Object.values(g.finance.receivables ?? {}).length;
    run(g, m.end + 60);
    expect(ac.cabin.label).toBe('12J/156Y');
    const invs = Object.values(g.finance.receivables ?? {});
    expect(invs.length).toBeGreaterThan(inv0);
    expect(invs.some((x) => x.amount === 40_000 && /Cabin reconfiguration/.test(x.desc))).toBe(true);
    // after the contract: the change back is booked and billed to the client
    run(g, c.end + 3 * DAY);
    expect(c.status).toBe('completed');
    const out = c.cabin!.outMx?.[ac.id] ? g.maintenance[c.cabin!.outMx[ac.id]] : undefined;
    expect(out?.clientCabin?.phase).toBe('out');
    run(g, out!.end + 60);
    expect(ac.cabin.label).toBe('180Y');
    expect(Object.values(g.finance.receivables ?? {}).some((x) => x.amount === 30_000 && /put back/.test(x.desc))).toBe(true);
  }, 120_000);

  it('optional: declined for a rate cut (no reconfiguration); required: cannot be declined', () => {
    const g = newGame(24);
    const ac = owned(g);
    const o = base(g, { layout: 'two-class', required: false });
    const off = termsProduct(o, { cabin: false });
    expect(askingPrice({ product: off })).toBeCloseTo(askingPrice(o) * (1 - o.cabin!.declinePct), -1);
    const rep = feasibility(g, o.id, ac.id, { cabin: false });
    expect(rep.checks.find((x) => x.id === 'cabinReq')!.label).toMatch(/^Client cabin declined: \d+% off the rate/);
    const r = acceptOffer(g, o.id, [ac.id], { cabin: false });
    if (!r.ok) throw new Error(r.error);
    const c = g.contracts[r.data!.contractId];
    expect(c.cabin?.accepted).toBe(false);
    expect(Object.values(g.maintenance).some((m) => m.kind === 'refit')).toBe(false);
    const g2 = newGame(25);
    const req = base(g2, { layout: 'two-class', required: true });
    expect(termsProduct(req, { cabin: false })).toEqual(req.product);
  });
});

// v0.7.4 × v0.8: the client cabin request on the new kinds of work, and with a mixed crew.
describe('client cabin requests on v0.8 work', () => {
  it('capacity leases may ask (rolled and forced); Hajj, UN, VIP, missions and dry leases never, even forced', () => {
    const never: Archetype[] = ['hajj', 'unRotation', 'vip', 'deportation', 'evacuation', 'medical', 'musicTour', 'antarctic', 'aogCover', 'adhoc'];
    let rolled = 0;
    let forced = 0;
    for (let s = 1; s <= 40; s++) {
      const g = newGame(s);
      g.company.standing = 2;
      for (const a of [...never, 'capacityLease' as const]) {
        for (const cabin of [undefined, { layout: 'two-class' as const }]) {
          const o = generateOffer(g, a, { wide: s % 2 === 0, window: false, ...(cabin ? { cabin } : {}) });
          if (!o) continue;
          if (a !== 'capacityLease') expect(o.cabin, a).toBeUndefined();
          else if (o.cabin) {
            if (cabin) forced++;
            else rolled++;
            expect(o.blurb).toContain('They want ');
            if (o.requirements.layouts) expect(o.requirements.layouts).toContain(o.cabin.layout);
          }
          delete g.offers[o.id];
        }
      }
      const dry = devDryLease(g);
      if (dry) expect(g.offers[dry].cabin).toBeUndefined();
    }
    expect(forced).toBeGreaterThan(20);
    expect(rolled).toBeGreaterThan(0);
    expect([...CABIN_REQUEST_KINDS].sort()).toEqual(['capacityLease', 'seasonBase', 'tourSeries']);
  }, 120_000);

  it('a mixed crew on the client cabin: their crew counted on its seats, the rate cut following', () => {
    // A330-300: two-class 350 seats (7 cabin crew), all-economy 440 (9).
    const M = (seats: number) => complement('a333', seats).filter((r) => r === 'PUR' || r === 'CC').length;
    expect([M(350), M(440)]).toEqual([7, 9]);
    expect(clientCrewOnCabin('a333', { n: 6, of: 7, leads: false }, 440)).toEqual({ n: 6, of: 9, leads: false });
    expect(clientCrewOnCabin('a333', { n: 7, of: 7, leads: true }, 440)).toEqual({ n: 9, of: 9, leads: true });
    expect(clientCrewOnCabin('a333', { n: 8, of: 9, leads: false }, 350)).toEqual({ n: 6, of: 7, leads: false });
    // On generated offers: whenever both come together, the clause is counted on the requested cabin.
    let both = 0;
    for (let s = 1; s <= 60 && both < 3; s++) {
      const g = newGame(s);
      const sn = Object.values(g.clients).find((c) => c.name === 'Air Sénégal');
      for (let i = 0; i < 6; i++) {
        const o = generateOffer(g, 'seasonBase', { wide: true, window: false, paint: false, client: sn?.id, days: 150, start: g.now + 40 * DAY, cabin: { layout: 'all-economy' } });
        if (!o) continue;
        const cc = o.requirements.clientCabin;
        if (cc && o.cabin) {
          both++;
          // The reference type the offer was priced on: the one its cabin line names.
          const ref = ACMI_TYPES_LIST.find((t) => o.blurb.includes(cabinTermsText(o.cabin!, t.id)))!;
          const t = cabinTarget(ref.id, o.cabin.layout)!;
          expect(cc.of).toBe(complement(ref.id, t.j + t.w + t.y).filter((r) => r === 'PUR' || r === 'CC').length);
          expect(cc.n).toBeLessThanOrEqual(cc.of);
          expect(cc.leads || cc.n < cc.of).toBe(true);
          expect(o.product.kind === 'wet' && o.product.ratePerBH).toBeGreaterThan(1000);
        }
        delete g.offers[o.id];
      }
    }
    expect(both).toBeGreaterThan(0);
  }, 120_000);
});
