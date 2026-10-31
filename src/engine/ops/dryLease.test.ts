// v0.8 dry lease out (UPDATE-0.8.md §6, §14): ferries flown by pilots only, the lease's money (deposit, rent in
// advance, reserves in arrears), the lessee's hours and A-checks, the C-check gate, late returns, damage, paint,
// insurance.

import { describe, expect, it } from 'vitest';
import { BAL } from '../core/balance';
import { typeOf } from '../core/perf';
import { DAY, monthKey, monthStart } from '../core/time';
import { addFlight } from '../core/entities';
import type { Contract, GameState, SimEvent } from '../core/types';
import { acceptOffer, cancelContract, cancelCost } from '../contracts';
import { feasibility } from '../contracts/feasibility';
import { devDryLease } from '../contracts/missions';
import { hamBase, newGame, owned, run } from '../contracts/testkit';
import { consentFor, dryPlan, dailyDryLeases, dryLeaseOf, dryLeaseView, leasedText, onLeaseBack, onLeaseFerryHome, onLeaseOut } from './dryLease';
import { fixedCosts } from './finance';

/** BAL.v08.dry with the two risks writable (tests force them). */
const D = BAL.v08.dry as unknown as { late: number; damage: number; lateDays: readonly [number, number]; lesseeShare: number };
const ev = (g: GameState, type: SimEvent['type'], id: string): SimEvent => ({ t: g.now, seq: 0, type, id, v: 0 });

/** A signed dry lease of the owned A320 (seeds where TAAG's offer fits it); the contract. */
function signed(seed = 3): { g: GameState; c: Contract } {
  for (let s = seed; s < seed + 30; s++) {
    const g = newGame(s);
    const id = devDryLease(g);
    if (!id) continue;
    const o = g.offers[id];
    if (o.dryFor !== owned(g).id || feasibility(g, id, owned(g).id).level === 'no') continue;
    const r = acceptOffer(g, id, [owned(g).id]);
    if (!r.ok) continue;
    return { g, c: g.contracts[r.data!.contractId] };
  }
  throw new Error('no dry lease signed');
}

/** Lands the delivery ferries now (no sim): done, aircraft at the site; then 'lease.out'. */
function deliver(g: GameState, c: Contract): void {
  const out = c.dry!.outIds.map((id) => g.flights[id]);
  g.now = Math.max(g.now, out[out.length - 1]?.sta ?? c.start - DAY);
  for (const f of out) {
    f.status = 'done';
    f.atd = f.std;
    f.ata = f.sta;
  }
  onLeaseOut(g, ev(g, 'lease.out', c.id));
}

describe('dry lease out (§6)', () => {
  it('signing: deposit in (cash only), ferries out and back planned and flown by two pilots only', () => {
    const { g, c } = signed();
    expect(c.product.kind).toBe('dry');
    const d = c.dry!;
    expect(d.outIds.length).toBeGreaterThan(0);
    expect(d.backIds.length).toBeGreaterThan(0);
    for (const id of [...d.outIds, ...d.backIds]) {
      expect(g.flights[id].kind).toBe('ferry');
      expect(g.flights[id].purpose).toBe('lease');
    }
    expect(g.flights[d.outIds[d.outIds.length - 1]].to).toBe(d.site);
    expect(g.flights[d.backIds[d.backIds.length - 1]].to).toBe(g.company.homeBase);
    // Pilots only on the ferry duties (roster run at signing or later).
    run(g, g.flights[d.outIds[0]].std - 2 * DAY);
    const f = g.flights[d.outIds[0]];
    if (f.dutyId) {
      const p = g.pairings[g.duties[f.dutyId].pairingId];
      expect(p.slots.every((s) => s.role === 'CPT' || s.role === 'FO')).toBe(true);
    }
    expect(dryLeaseView(g, c.id)?.phase).toBe('signed');
  });

  it('delivery: leased out at the site, paint, rent in advance; the lessee\'s hours and A-checks; reserves in arrears', () => {
    const { g, c } = signed();
    const ac = g.fleet[c.aircraftIds[0]];
    const d = c.dry!;
    d.paint = d.paint ?? 'decals';
    const recv0 = g.finance.receivables.length;
    deliver(g, c);
    expect(ac.status).toBe('leasedOut');
    expect(ac.at).toBe(d.site);
    expect(ac.paintedFor).toBe(c.id);
    expect(leasedText(g, ac.id)).toMatch(/^Leased to .+ until .+ · 0 FH flown by them at /);
    const rent = g.finance.receivables.slice(recv0).find((r) => r.cat === 'leaseIncome' && /^Rent/.test(r.desc));
    expect(rent).toBeDefined();
    // Insurance: the lessee's while she is out.
    // v0.12.1 by the days she is out (from the handover), not by the status at month end.
    const ins = fixedCosts(g, monthKey(g.now)).insurance;
    const at = d.leasedAt;
    d.leasedAt = undefined;
    expect(fixedCosts(g, monthKey(g.now)).insurance).toBeGreaterThan(ins);
    d.leasedAt = at;
    // A month of their flying: hours on our airframe, the A-check counter reset by their own checks.
    const h0 = ac.hours;
    const k0 = monthKey(g.now);
    ac.maint.fhSinceA = typeOf(ac.typeId).aCheckFH * 0.94;
    let reset = false;
    for (let i = 0; i < 40; i++) {
      g.now += DAY;
      dailyDryLeases(g);
      if (ac.maint.fhSinceA < 20) reset = true;
    }
    expect(reset).toBe(true);
    expect(ac.hours - h0).toBeGreaterThan(d.fhPerMonth * 0.8);
    expect(d.fh).toBeCloseTo(ac.hours - h0, 5);
    // The new month: last month's reserves (arrears) and this month's rent (advance).
    expect(monthKey(g.now)).toBeGreaterThan(k0);
    const res = g.finance.receivables.find((r) => r.contractId === c.id && /^Reserves/.test(r.desc));
    expect(res).toBeDefined();
    expect(res!.cat).toBe('leaseIncome');
    expect(g.finance.receivables.filter((r) => r.contractId === c.id && /^Rent/.test(r.desc)).length).toBeGreaterThanOrEqual(2);
    expect(dryLeaseOf(g, ac.id)?.phase).toBe('leased');
  });

  it('a late return pays 150 % holdover and moves the ferry home', () => {
    const { g, c } = signed();
    deliver(g, c);
    const d = c.dry!;
    const was = D.late;
    D.late = 1;
    try {
      const end = d.leaseEnd ?? c.end;
      g.now = end;
      const back0 = g.flights[d.backIds[0]].std;
      onLeaseBack(g, ev(g, 'lease.back', c.id));
      expect(d.late).toBeGreaterThanOrEqual(D.lateDays[0]);
      expect(g.flights[d.backIds[0]].std).toBe(back0 + d.late! * DAY);
      const hold = g.finance.receivables.find((r) => r.contractId === c.id && /^Holdover rent 150 %/.test(r.desc))!;
      const p = c.product.kind === 'dry' ? c.product : null;
      expect(hold.amount).toBe(Math.round((p!.rentPerMonth * 1.5 * d.late! * DAY) / (30.44 * DAY)));
      expect(g.messages[0].title).toMatch(/days late$/);
      // Still out until the late date.
      expect(d.returnedAt).toBeUndefined();
      g.now = end + d.late! * DAY;
      onLeaseBack(g, ev(g, 'lease.back', c.id));
      expect(d.returnedAt).toBe(g.now);
      expect(g.fleet[c.aircraftIds[0]].status).toBe('available');
    } finally {
      D.late = was;
    }
  });

  it('back home: return inspection, damage split 70/30 against the deposit, colours back, completed', () => {
    const { g, c } = signed();
    deliver(g, c);
    const d = c.dry!;
    const ac = g.fleet[c.aircraftIds[0]];
    d.late = 0;
    g.now = d.leaseEnd ?? c.end;
    onLeaseBack(g, ev(g, 'lease.back', c.id));
    const was = D.damage;
    D.damage = 1;
    try {
      const back = d.backIds.map((id) => g.flights[id]);
      for (const f of back) {
        f.status = 'done';
        f.atd = f.std;
        f.ata = f.sta;
      }
      g.now = back[back.length - 1].sta;
      const cash0 = g.company.cash;
      onLeaseFerryHome(g, back[back.length - 1]);
      expect(d.damage).toBeDefined();
      const share = Math.round(d.damage!.cost * D.lesseeShare);
      const kept = Math.min(d.deposit, share);
      expect(Math.round(cash0 - g.company.cash)).toBe(d.deposit - kept);
      const mx = g.maintenance[d.damage!.maintId!];
      expect(mx.cost).toBe(d.damage!.cost);
      expect((mx.end - mx.start) / DAY).toBe(d.damage!.days);
      if (share > kept) expect(g.finance.receivables.some((r) => r.contractId === c.id && /^Damage repair 70 %/.test(r.desc))).toBe(true);
      expect(ac.paintedFor).toBeUndefined();
      expect(c.status).toBe('completed');
      expect(dryLeaseView(g, c.id)?.phase).toBe('done');
    } finally {
      D.damage = was;
    }
  });

  it('the C-check stays ours: a lease running past it is refused with a booking action', () => {
    const g = newGame(3);
    const id = devDryLease(g);
    expect(id).not.toBe('');
    const ac = owned(g);
    // The calendar limit falls inside the lease (last C-check 23 months ago).
    ac.maint.lastC = g.now - 23 * 30.44 * DAY;
    const rep = feasibility(g, id, ac.id);
    const line = rep.checks.find((x) => x.id === 'dryLease' && x.level === 'no');
    expect(line?.label).toMatch(/^C-check due .+, during the lease: book it before$/);
    expect(line?.action).toEqual({ kind: 'cCheck', aircraftId: ac.id });
    expect(rep.level).toBe('no');
  });
});

it('rent months are whole-day pro-rata in advance', () => {
  const { g, c } = signed();
  deliver(g, c);
  const first = g.finance.receivables.find((r) => r.contractId === c.id && /^Rent/.test(r.desc))!;
  const p = c.product.kind === 'dry' ? c.product : null;
  const days = (monthStart(monthKey(g.now) + 1) - g.now) / DAY;
  expect(first.amount).toBe(Math.round((p!.rentPerMonth * days * DAY) / (30.44 * DAY)));
});

describe('v0.8 fix round 1: recall, holdover, consent', () => {
  it('cancelling after delivery recalls her: ferried home, available, deposit back, a month\'s rent to the lessee', () => {
    const { g, c } = signed();
    deliver(g, c);
    const ac = g.fleet[c.aircraftIds[0]];
    const cost = cancelCost(g, c.id);
    const p = c.product.kind === 'dry' ? c.product : null;
    expect(cost.penalty).toBe(Math.round(p!.rentPerMonth));
    const cash0 = g.company.cash;
    const r = cancelContract(g, c.id);
    expect(r.ok).toBe(true);
    // Penalty and unused rent out (plus the ferry crew's tickets, if any).
    expect(g.company.cash).toBeLessThanOrEqual(cash0 - cost.penalty - cost.refund);
    expect(g.company.cash).toBeGreaterThan(cash0 - cost.penalty - cost.refund - 20_000);
    expect(c.dry!.recalled).toBe(g.now);
    // The return ferries are still there, two days out plus the inspection day.
    const back = c.dry!.backIds.map((id) => g.flights[id]);
    expect(back.every((f) => f && f.status === 'scheduled')).toBe(true);
    expect(back[0].std).toBeLessThanOrEqual(g.now + 3 * DAY + 8 * 60 + 15);
    const deposit0 = g.company.cash;
    run(g, back[back.length - 1].sta + 3 * DAY);
    expect(ac.status).not.toBe('leasedOut');
    expect(ac.at).toBe(g.company.homeBase);
    expect(c.status).toBe('cancelled');
    expect(dryLeaseOf(g, ac.id)).toBeNull();
    expect(g.company.cash).toBeLessThan(deposit0 + 1); // deposit paid back to them (cash out)
  });

  it('a late return across a month end bills the late days once (holdover only)', () => {
    const { g, c } = signed();
    deliver(g, c);
    const d = c.dry!;
    const was = D.late;
    const days = D.lateDays;
    D.late = 1;
    // 32 days late: always across a month start.
    (D as { lateDays: readonly [number, number] }).lateDays = [32, 32];
    try {
      const end = d.leaseEnd ?? c.end;
      g.now = end;
      onLeaseBack(g, ev(g, 'lease.back', c.id));
      expect(d.late).toBe(32);
      const back = end + d.late! * DAY;
      // Daily passes through the late days, across the next month start.
      for (let t = end; t < back; t += DAY) {
        g.now = t;
        dailyDryLeases(g);
      }
      const rents = g.finance.receivables.filter((r) => r.contractId === c.id && /^Rent/.test(r.desc));
      const after = rents.filter((r) => r.issued > end);
      expect(after.length).toBe(0);
    } finally {
      D.late = was;
      (D as { lateDays: readonly [number, number] }).lateDays = days;
    }
  });

  it('the consent fee follows the airframe picked: none on an owned one, the fee on a leased-in one', () => {
    const g = newGame(3);
    const ac = owned(g);
    expect(consentFor(ac)).toBe(0);
    const ln = Object.values(g.fleet).find((a) => a.ownership.kind === 'dryLeaseIn');
    if (ln) expect(consentFor(ln)).toBe(typeOf(ln.typeId).body === 'wide' ? BAL.v08.dry.consent.wide : BAL.v08.dry.consent.narrow);
  });
});

describe('v0.8 fix pack: a dry lease never over a signed base programme', () => {
  it("the base's later weeks (not rolled out as flights yet) make the aircraft busy for a dry lease", () => {
    let checked = 0;
    for (let s = 3; s < 30 && checked < 3; s++) {
      const g = newGame(s);
      const ac = owned(g);
      const id = devDryLease(g);
      if (!id || g.offers[id].dryFor !== ac.id || feasibility(g, id, ac.id).level === 'no') continue;
      const o = g.offers[id];
      // A season base on the same A320 from the middle of the lease, signed after the dry lease was offered.
      const b = hamBase(g, Math.round((o.start + o.end) / 2), 40);
      const r = acceptOffer(g, b.id, [ac.id]);
      if (!r.ok) continue;
      const k = g.contracts[r.data!.contractId];
      expect(k.generatedUntil).toBeLessThan(k.pattern.kind === 'base' ? k.pattern.to : 0);
      const rep = feasibility(g, id, ac.id);
      expect(rep.level).toBe('no');
      expect(rep.checks.find((c) => c.id === 'availability')?.label).toMatch(/^Busy: .+ \(.+–.+\)$/);
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });
});

describe('v0.12.1 the ferry out leaves from where the aircraft is then', () => {
  it('a leg landing at Prague two days before the lease start: the ferry leaves Prague', () => {
    const g = newGame(3);
    const ac = owned(g);
    const start = g.now + 20 * DAY;
    const arr = start - 2 * DAY;
    addFlight(g, { no: 'AW1', aircraftId: ac.id, contractId: null, kind: 'revenue', from: ac.at, to: 'PRG', std: arr - 200, sta: arr });
    const plan = dryPlan(g, { start, end: start + 90 * DAY, dry: { site: 'WAW' } as never }, ac);
    expect(plan?.from).toBe('PRG');
    expect(plan?.out[0]?.from).toBe('PRG');
  });
});
