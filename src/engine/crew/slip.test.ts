// v0.9 crew slip at a fuel stop (UPDATE-0.9.md §W): the best stop, feasibility's line, the price, offer generation and
// the roster's cut agree; a chain that would need two slips stays impossible.

import { describe, expect, it } from 'vitest';
import { acceptOffer, feasibility } from '../contracts';
import { crewCanFly } from '../contracts/offers';
import { planSector } from '../core/perf';
import { DAY } from '../core/time';
import type { AcRest } from '../core/types';
import { devAddType, devSlipOffer } from '../dev';
import { autoRoster } from '.';
import type { ChainShape } from './duties';
import { fixtureGame } from './fixtures';
import { bestSlip, slipCost, slipOfFlight, slipsOfAircraft } from './slip';

const NO_REST: AcRest = { fc: null, cc: null };

function chainOf(typeId: string, from: string, to: string, std: number): ChainShape {
  const sp = planSector(typeId, from, to);
  let t = std;
  const legs = sp.legs.map((l) => {
    const leg = { std: t, sta: t + l.block, from: l.from, to: l.to };
    t += l.block + 60;
    return leg;
  });
  return { from, std, legs };
}

describe('§W bestSlip', () => {
  it('Madrid–Singapore on an A330 without rest on board changes crews at Istanbul', () => {
    const g = fixtureGame(51);
    const std = Math.floor(g.now / DAY) * DAY + 3 * DAY + 9 * 60;
    const c = chainOf('a332', 'MAD', 'SIN', std);
    expect(c.legs.map((l) => l.to)).toEqual(['IST', 'SIN']);
    const s = bestSlip(g, 'a332', NO_REST, c)!;
    expect(s).not.toBeNull();
    expect(s.at).toBe('IST');
    expect(s.text).toBe('Crew change at IST (fresh crew flies in)');
    expect(s.first.mode).not.toBe('none');
    expect(s.second.mode).not.toBe('none');
    expect(s.tickets).toBeGreaterThan(0);
    expect(slipCost(s)).toBeGreaterThan(s.tickets);
  });

  it('a chain one crew can fly needs no slip; one that would need two stays impossible', () => {
    const g = fixtureGame(52);
    const std = Math.floor(g.now / DAY) * DAY + 3 * DAY + 9 * 60;
    expect(bestSlip(g, 'a320ceo', NO_REST, { from: 'LIS', std, legs: [{ std, sta: std + 120, from: 'LIS', to: 'FAO' }, { std: std + 180, sta: std + 300, from: 'FAO', to: 'LIS' }] })).toBeNull();
    // Dili–Lisbon on an A321neo with three long legs: no single cut leaves two flyable halves without rest.
    const c = chainOf('a321neo', 'DIL', 'LIS', std);
    expect(c.legs.length).toBe(3);
    const long = { ...c, legs: c.legs.map((l, i) => ({ ...l, std: l.std + i * 0, sta: l.sta + (i === 1 ? 6 * 60 : 0) })) };
    expect(bestSlip(g, 'a321neo', NO_REST, long)).toBeNull();
  });
});

describe('§W offers, feasibility, pricing and the roster', () => {
  it('Dili–Lisbon: offered with the crew change priced in; feasibility warns; the roster cuts the duty at the same stop', () => {
    const g = fixtureGame(53);
    const id = devSlipOffer(g, 'DIL-LIS');
    expect(id).not.toBe('');
    const o = g.offers[id];
    expect(o.slip!.at.length).toBe(1);
    expect(o.slip!.cost).toBeGreaterThan(5_000);
    const at = o.slip!.at[0];
    // Offer generation counts the slip as a valid plan.
    const leg = o.pattern.kind === 'legs' ? o.pattern.legs[0] : null;
    expect(crewCanFly(g, 'a321neo', [chainOf('a321neo', leg!.from, leg!.to, o.start)])).toBe(true);
    // Feasibility on an A321neo of ours: the line and its plain detail.
    const acId = devAddType(g, 'a321neo');
    g.company.approvals.push('etops120', 'etops180');
    const rep = feasibility(g, id, acId);
    const rest = rep.checks.find((c) => c.id === 'rest');
    expect(rest?.label).toBe(`Crew change at ${at} (fresh crew flies in)`);
    expect(rest?.level).toBe('warn');
    expect(rest?.detail).toMatch(/A second crew flies to .* by airline the day before and rests; it takes over/);
    expect(rest?.detail).toMatch(/priced in/);
    // Signed and rostered: the duty is cut at the stop, both duties record it, nobody's day is illegal.
    g.company.cash = 50_000_000;
    const r = acceptOffer(g, id, [acId]);
    expect(r.ok ? '' : r.error).toBe('');
    autoRoster(g, { aircraftIds: [acId], to: g.now + 20 * DAY });
    const flights = Object.values(g.flights).filter((f) => f.aircraftId === acId && f.contractId && f.kind !== 'positioning');
    const took = flights.find((f) => f.from === at);
    expect(took).toBeTruthy();
    const d = g.duties[took!.dutyId!];
    expect(d.slipAt).toBe(at);
    expect(d.legality).not.toBe('illegal');
    const before = flights.find((f) => f.to === at)!;
    expect(g.duties[before.dutyId!].slipAt).toBe(at);
    expect(before.dutyId).not.toBe(took!.dutyId);
    const v = slipOfFlight(g, took!.id)!;
    expect(v.at).toBe(at);
    expect(v.text).toMatch(/^Crew change at /);
    expect(slipsOfAircraft(g, acId, g.now, g.now + 30 * DAY).length).toBe(1);
  });
});
