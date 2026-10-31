// v0.12.1 Round F (lane A): diversions, the onward card and the planners around them (ops/disrupt.ts).

import { describe, expect, it } from 'vitest';
import { acceptOffer, relinkPositioning } from '../contracts';
import { onwardPending } from '../contracts/plan';
import { hamBase, leased, legsOffer, newGame, owned } from '../contracts/testkit';
import { flightsOf } from '../core/entities';
import { DAY } from '../core/time';
import type { Aircraft, Flight, GameState } from '../core/types';
import { advanceTo } from '../sim';
import { flightCrewStatus } from '../crew';
import { devDisruption } from './disrupt';
import { resolveDecision } from './index';
import { isRevenue, turnOf } from './util';

const skip = (g: GameState, t: number) => advanceTo(g, t, new Set());
const line = (g: GameState, cat: string) => (g.finance.current.lines as Record<string, number>)[cat] ?? 0;
const scheduled = (g: GameState, ac: Aircraft) => flightsOf(g, ac.id).filter((f) => f.status === 'scheduled').sort((a, b) => a.std - b.std);

/** A charter LIS–FUE–LIS three days out on the leased A320, signed. */
function charter(seed = 6): { g: GameState; ac: Aircraft; legs: Flight[] } {
  const g = newGame(seed);
  const ac = leased(g);
  const t0 = Math.floor(g.now / DAY) * DAY + 3 * DAY;
  const o = legsOffer(g, [['LIS', 'FUE', t0 + 9 * 60], ['FUE', 'LIS', t0 + 13 * 60]], 150);
  o.broker = undefined;
  const r = acceptOffer(g, o.id, [ac.id]);
  if (!r.ok) throw new Error(r.error);
  return { g, ac, legs: flightsOf(g, ac.id).filter((f) => f.contractId === r.data!.contractId && isRevenue(f)) };
}

/** Advances (answering cards with their defaults) until the leg is airborne. */
function airborne(g: GameState, f: Flight, after = 20): void {
  for (let i = 0; i < 400 && f.status === 'scheduled' && !f.operatedBy; i++) {
    skip(g, Math.min(f.std + f.delay + 5, g.now + 60));
    for (const d of [...g.decisions]) resolveDecision(g, d.id, d.defaultOption);
    g.decisions.length = 0;
  }
  expect(f.status).toBe("enroute");
  g.decisions.length = 0;
  skip(g, g.now + after);
}

/** Diverts the airborne leg to its first alternate (forced card), lands it there; returns the onward card. */
function divertAndLand(g: GameState, f: Flight, kind: 'diversion' | 'technical' = 'diversion', pick?: (ids: string[]) => string) {
  expect(devDisruption(g, kind, f.id)).toBe(true);
  const d = g.decisions.find((x) => x.kind === 'diversion')!;
  const alts = d.options.filter((o) => o.id.startsWith('alt:')).map((o) => o.id);
  const opt = pick ? pick(alts) : alts[0];
  expect(resolveDecision(g, d.id, opt).ok).toBe(true);
  return { alt: opt.slice(4) };
}

const emptyFrom = (g: GameState, ac: Aircraft, at: string) => scheduled(g, ac).filter((x) => x.kind === 'positioning' && x.from === at);

describe('A1: no empty legs planned while a diversion is open', () => {
  it('relink waits while the leg turns for the alternate and while the onward card is open; fly on keeps the card time', () => {
    const { g, ac, legs } = charter(6);
    const f = legs[0];
    airborne(g, f);
    const { alt } = divertAndLand(g, f);
    expect(onwardPending(g, ac.id)).toBe(true);
    expect(relinkPositioning(g, ac.id)).toEqual([]);
    expect(emptyFrom(g, ac, alt)).toEqual([]);
    skip(g, (f.eta ?? f.sta) + 1);
    const on = g.decisions.find((x) => x.kind === 'divertOnward')!;
    expect(on).toBeDefined();
    expect(onwardPending(g, ac.id)).toBe(true);
    // Settles in between plan nothing out of the alternate.
    for (let i = 0; i < 3; i++) relinkPositioning(g, ac.id);
    expect(emptyFrom(g, ac, alt)).toEqual([]);
    // v0.12.1 the card is answered before the crew's duty ends at release.
    const d = g.duties[f.dutyId!];
    if (d) expect(on.expires).toBeLessThanOrEqual(d.release - 5);
    const fly = on.options.find((o) => o.id === 'flyOn');
    if (!fly) return;
    const flyAt = Number(on.data!.flyAt);
    expect(resolveDecision(g, on.id, 'flyOn').ok).toBe(true);
    expect(onwardPending(g, ac.id)).toBe(false);
    const x = g.flights[f.contOf!];
    expect(Math.abs(x.std - flyAt)).toBeLessThanOrEqual(5);
    // "Same crew, within their day" is what happens.
    if (fly.chips?.includes('Same crew, within their day')) {
      expect(x.dutyId).toBe(f.dutyId);
      expect(flightCrewStatus(g, x.id, { live: false }).level).not.toBe('missing');
    }
    // Relinked again and again: never two copies of an empty leg.
    for (let i = 0; i < 4; i++) {
      skip(g, g.now + 30);
      relinkPositioning(g, ac.id);
    }
    const pos = scheduled(g, ac).filter((y) => y.kind === 'positioning');
    for (const a of pos) expect(pos.filter((b) => b !== a && b.from === a.from && b.to === a.to && Math.abs(b.std - a.std) <= turnOf(ac)).length).toBe(0);
  });

  it('coached passengers: exactly one empty leg takes the aircraft on, planned after the decision', () => {
    const { g, ac, legs } = charter(6);
    const f = legs[0];
    airborne(g, f);
    const { alt } = divertAndLand(g, f);
    skip(g, (f.eta ?? f.sta) + 1);
    const on = g.decisions.find((x) => x.kind === 'divertOnward')!;
    if (!on.options.some((o) => o.id === 'bus')) return;
    expect(resolveDecision(g, on.id, 'bus').ok).toBe(true);
    expect(f.div?.settled).toBe(true);
    for (let i = 0; i < 3; i++) relinkPositioning(g, ac.id);
    const out = emptyFrom(g, ac, alt);
    expect(out.length).toBe(1);
    expect(out[0].to).toBe('FUE');
  });
});

describe('A2: a technical diversion back to the departure airport keeps the return leg', () => {
  it('the wave out returns to base: the return is flown late behind the onward leg, never cancelled or flown empty', () => {
    const g = newGame(11);
    const ac = owned(g);
    const r = acceptOffer(g, hamBase(g, g.now + 2 * DAY, 30, 3).id, [ac.id]);
    if (!r.ok) throw new Error(r.error);
    const c = g.contracts[r.data!.contractId];
    const p = c.pattern;
    advanceTo(g, (p.kind === 'base' ? p.from : g.now) + 2 * DAY, new Set());
    g.decisions.length = 0;
    // The first wave out our own crew flies (a crew shortage may hand one to a rival).
    let out: Flight | undefined;
    for (let k = 0; k < 6 && !out; k++) {
      const f = scheduled(g, ac).find((y) => y.from === 'HAM' && y.to === 'PMI' && y.contractId === c.id && y.std > g.now + 60 && !y.operatedBy)!;
      for (let i = 0; i < 400 && f.status === 'scheduled' && !f.operatedBy; i++) {
        skip(g, Math.min(f.std + f.delay + 5, g.now + 60));
        g.decisions.length = 0;
      }
      if (f.status === 'enroute') out = f;
    }
    if (!out) throw new Error('no wave flown');
    const ret = scheduled(g, ac).find((y) => y.from === 'PMI' && y.to === 'HAM' && y.std > out!.std)!;
    skip(g, g.now + 10);
    const pen0 = line(g, 'penalties');
    const { alt } = divertAndLand(g, out, 'technical', (ids) => ids.find((id) => id === 'alt:HAM') ?? ids[0]);
    if (alt !== 'HAM') return;
    skip(g, (out.eta ?? out.sta) + 1);
    // The inspection names the fault the crew wrote up.
    const mx = Object.values(g.maintenance).find((m) => m.aircraftId === ac.id && !m.planned && m.status === 'inWork')!;
    expect(mx.cause).toMatch(/^Inspection after (a |an )/);
    expect(mx.cause).not.toMatch(/: done|congestion|technical problem in flight/);
    // Answered here, or by operations at once (the pacing budget): the passengers fly on either way.
    const on = g.decisions.find((x) => x.kind === 'divertOnward');
    if (on) expect(resolveDecision(g, on.id, on.options.some((o) => o.id === 'flyOn') ? 'flyOn' : 'hotel').ok).toBe(true);
    expect(out.div?.settled).toBe(true);
    if (!out.contOf) return;
    const x = g.flights[out.contOf!];
    expect(x.from).toBe('HAM');
    expect(x.to).toBe('PMI');
    // The wave's own return brings the aircraft and its passengers home: late, kept (a later wave may be dropped).
    expect(ret.status).toBe('scheduled');
    expect(ret.std).toBeGreaterThanOrEqual(x.sta + turnOf(ac));
    // No empty PMI–HAM or HAM–PMI, and every leg leaves from where the one before landed.
    for (let i = 0; i < 3; i++) relinkPositioning(g, ac.id);
    const legs = scheduled(g, ac);
    expect(legs.filter((y) => y.kind === 'positioning' && ((y.from === 'PMI' && y.to === 'HAM') || (y.from === 'HAM' && y.to === 'PMI')))).toEqual([]);
    for (let i = 1; i < legs.length; i++) expect(legs[i].from).toBe(legs[i - 1].to);
    // Compensation only for a later wave dropped for lateness, never for the diverted one's own return.
    const lost = flightsOf(g, ac.id).filter((y) => y.status === 'cancelled' && y.contractId === c.id && isRevenue(y));
    expect(lost).not.toContain(ret);
    expect(line(g, 'penalties') - pen0).toBe(-lost.length * c.penalties.perCancelledLeg);
  });
});
