// v0.7.4 client cabin requests: on the offer like client paint, a quick reconfiguration before the start booked at
// signing, the client's share invoiced when the work ends, optional requests declined for a rate cut, and the cabin
// put back after the contract (at the client's expense when it ran its course).

import { describe, expect, it } from 'vitest';
import { BAL } from '../core/balance';
import { DAY } from '../core/time';
import { acceptOffer, feasibility } from '.';
import { askingPrice } from './accept';
import { cabinQuote, cabinTermsText, termsProduct } from './cabinTerms';
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
