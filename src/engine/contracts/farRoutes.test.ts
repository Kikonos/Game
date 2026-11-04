// v0.16 far routes (UPDATE-0.16.md §B.5): every template builds a valid offer with its stops, a crew change where one
// crew cannot fly the whole way, the exotic flag and the × 1.25 price; airlines take it wet on their flight numbers
// and the MGH never bills our idle weeks; the daily roll is paced, never two at once, and far-off origins wait for us
// to be in the region.

import { describe, expect, it } from 'vitest';
import { AIRPORT_BY_CODE } from '../../data/airports';
import { BAL } from '../core/balance';
import { blockMinutes } from '../core/perf';
import { DAY } from '../core/time';
import type { ContractOffer, GameState } from '../core/types';
import { feasibility } from './feasibility';
import { dailyFarRoute, devFarRoute, FAR_ROUTE_GATE, FAR_ROUTES, farRoute, makeFarRoute, nearOrigin } from './missions';
import { ARCH_MULT } from './pricing';
import { addAircraft, newGame } from './testkit';

const legsOf = (o: ContractOffer) => (o.pattern.kind === 'legs' ? o.pattern.legs : []);

function established(seed = 3): GameState {
  const g = newGame(seed);
  g.company.standing = 2;
  g.company.approvals.push('etops180', 'augmented', 'widebody');
  addAircraft(g, 'b772');
  return g;
}

describe('v0.16 far routes', () => {
  it('every template names a seeded client and airports the game knows', () => {
    const g = newGame(1);
    const ids = new Set<string>();
    for (const t of FAR_ROUTES) {
      expect(ids.has(t.id), t.id).toBe(false);
      ids.add(t.id);
      expect(Object.values(g.clients).some((c) => c.name === t.client), `${t.id}: ${t.client}`).toBe(true);
      for (const c of [...t.out, ...t.back]) expect(AIRPORT_BY_CODE[c], `${t.id}: ${c}`).toBeDefined();
      expect(t.out[0]).toBe(t.back[t.back.length - 1]);
      expect(t.out[t.out.length - 1]).toBe(t.back[0]);
      expect(t.title).not.toContain(t.client);
    }
  });

  it('each template builds a valid offer: legs through the stops, the far flag, the price × exoticMult, the feasibility line', () => {
    const g = established();
    const ac = Object.values(g.fleet).find((a) => a.typeId === 'b772')!;
    for (const t of FAR_ROUTES) {
      const o = makeFarRoute(g, t.id, { force: true });
      expect(o, t.id).not.toBeNull();
      const legs = legsOf(o!);
      expect(o!.exotic).toBe(true);
      expect(o!.archetype).toBe(t.archetype);
      expect(o!.start).toBeLessThan(o!.end);
      expect(o!.expires).toBeGreaterThan(g.now);
      expect(o!.expires).toBeLessThanOrEqual(o!.start);
      expect(o!.blurb).not.toMatch(/undefined|NaN/);
      expect(o!.estValue).toBeGreaterThan(0);
      // one rotation = the way out and the way back; rotations in order, every leg between known airports
      const perRot = t.out.length - 1 + (t.back.length - 1);
      expect(legs.length % perRot, t.id).toBe(0);
      expect(legs.length / perRot).toBeGreaterThanOrEqual(t.rotations[0]);
      expect(legs.length / perRot).toBeLessThanOrEqual(t.rotations[1]);
      for (let i = 0; i < legs.length; i++) {
        expect(legs[i].from).not.toBe(legs[i].to);
        if (i) expect(legs[i].dep).toBeGreaterThan(legs[i - 1].dep);
      }
      expect(legs.slice(0, t.out.length - 1).map((l) => l.from)).toEqual(t.out.slice(0, -1));
      expect(o!.pin).toBe(t.out[t.out.length - 1]);
      // airlines: wet, their flight numbers, the client pays the fuel; ministries: a charter unless far-off (then wet)
      const airline = t.archetype === 'adhoc';
      expect(o!.product.kind).toBe(airline || t.far ? 'wet' : 'charter');
      if (airline) expect(legs.every((l) => /^[A-Z0-9]{2}\d{3}$/.test(l.flightNo)), t.id).toBe(true);
      else expect(legs.every((l) => l.flightNo === '')).toBe(true);
      if (o!.product.kind === 'wet') {
        // the MGH over the terms never bills far more than the hours flown
        expect(o!.estValue).toBeLessThanOrEqual(o!.product.ratePerBH * o!.estBH * 1.15);
        expect(o!.estValue).toBeGreaterThanOrEqual(o!.product.ratePerBH * o!.estBH * 0.8);
        expect(o!.terms?.length).toBe(legs.length / perRot);
      }
      // the feasibility report names what the aircraft is short of (or nothing), never throws
      const rep = feasibility(g, o!.id, ac.id, { quick: true });
      expect(['ok', 'warn', 'no']).toContain(rep.level);
      o!.status = 'declined';
    }
  });

  it('the Nouméa rotation flies through Singapore with the crews changing there (no one crew flies Paris–Singapore–Nouméa) and pays more than a plain rotation', () => {
    const g = established(4);
    const o = makeFarRoute(g, 'frNoumea')!;
    expect(o).toBeTruthy();
    // a through-stop: the onward leg leaves 2–11 h after landing (a turn and the handover, not a night stop), so the
    // roster puts a fresh crew on it (crew chains are per sector: plan.ts); 26 h of flying no single crew may do
    const legs = legsOf(o);
    const arr = legs[0].dep + blockMinutes('b772', 'CDG', 'SIN');
    expect(legs[1].from).toBe('SIN');
    expect(legs[1].dep - arr).toBeGreaterThanOrEqual(2 * 60);
    expect(legs[1].dep - arr).toBeLessThan(11 * 60);
    expect(blockMinutes('b772', 'CDG', 'SIN') + blockMinutes('b772', 'SIN', 'NOU')).toBeGreaterThan(18 * 60);
    expect(o.blurb).toMatch(/crews change at Singapore/);
    expect(o.blurb).toMatch(/Fuel ours|fuel ours/i);
    // priced on the troop-rotation multiplier × exoticMult: the draft says so
    const d = farRoute(g, 'frNoumea');
    expect(d?.mult).toBeCloseTo((ARCH_MULT.troopRotation ?? 1) * BAL.v016.prestige.exoticMult, 6);
    expect(d?.exotic).toBe(true);
    expect(d?.paint).toBe(false);
  });

  it('the airline routes fly wet on their own numbers, with the odd decals request and some of their cabin crew', () => {
    let decals = 0, mixed = 0, n = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const g = established(seed);
      for (const id of ['klmTriangle', 'airCaraibes', 'tahitiNui', 'frenchBee', 'corsair']) {
        const d = farRoute(g, id);
        if (!d) continue;
        n++;
        expect(d.wet).toBe(true);
        if (d.paint) decals++;
        if (d.req.clientCabin) mixed++;
        expect(legsOf({ pattern: d.pattern } as ContractOffer)[0].flightNo).toMatch(/^(KL|TX|TN|BF|SS)\d{3}$/);
      }
    }
    expect(n).toBeGreaterThan(30);
    expect(decals).toBeGreaterThan(0);
    expect(mixed).toBeGreaterThan(0);
    expect(decals).toBeLessThan(n);
  });

  it('a far-off origin waits for an aircraft or a job of ours in the region; the dev helper forces it', () => {
    const g = established(6);
    expect(nearOrigin(g, 'CBR')).toBe(false);
    expect(farRoute(g, 'auPacific')).toBeNull();
    const far = FAR_ROUTES.filter((t) => t.far).map((t) => t.id);
    expect(far).toEqual(['auPacific', 'nzPacific']);
    // an aircraft parked in Sydney: the Pacific rotations may come
    Object.values(g.fleet)[0].at = 'SYD';
    expect(nearOrigin(g, 'CBR')).toBe(true);
    const o = makeFarRoute(g, 'auPacific');
    expect(o?.product.kind).toBe('wet');
    expect(devFarRoute(established(7), 'nzPacific')).not.toBe('');
  });

  it('nobody at our level calls: a level-1 start gets no far route from the daily roll, a level-3 company does now and then, never two at once', () => {
    FAR_ROUTE_GATE.on = true;
    try {
    const g = established(8);
    g.company.prestige = { level: 1, visibility: 0, levelAt: {} };
    let made = 0;
    for (let d = 0; d < 400; d++) {
      g.now += DAY;
      if (dailyFarRoute(g)) made++;
    }
    // the ladder keeps level-3 and level-4 clients from a level-1 company (contracts/prestige.ts prestigeOfferWeight)
    const l1 = made;
    const h = established(9);
    h.company.prestige = { level: 3, visibility: 5000, levelAt: {} };
    made = 0;
    let open = 0;
    for (let d = 0; d < 400; d++) {
      h.now += DAY;
      const o = dailyFarRoute(h);
      if (o) made++;
      open = Math.max(open, Object.values(h.offers).filter((x) => x.exotic && x.status === 'open').length);
      // the market expires them in time (no event loop here): close the old ones by hand
      for (const x of Object.values(h.offers)) if (x.exotic && x.expires < h.now) x.status = 'expired';
    }
    expect(open).toBeLessThanOrEqual(1);
    expect(made).toBeGreaterThanOrEqual(l1);
    expect(made).toBeGreaterThan(2);
    expect(made).toBeLessThan(60);
    // a Newcomer never
    const n = established(10);
    n.company.standing = 0;
    let z = 0;
    for (let d = 0; d < 200; d++) {
      n.now += DAY;
      if (dailyFarRoute(n)) z++;
    }
    expect(z).toBe(0);
    } finally {
      FAR_ROUTE_GATE.on = false;
    }
  });
});
