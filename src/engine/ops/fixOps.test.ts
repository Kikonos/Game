// v0.15.1 ops fixes: a curfew night stop moves the legs after it; the AOG default takes the cheapest way out (the
// team when it saves more than it costs, a free aircraft when any wait drops legs).

import { describe, expect, it } from 'vitest';
import { addFlight, flightsOf, ownFlightNo } from '../core/entities';
import { blockMinutes, typeOf } from '../core/perf';
import { DAY } from '../core/time';
import type { Aircraft, Flight, GameState, Minute } from '../core/types';
import { acceptOffer } from '../contracts';
import { leased, legsOffer, newGame, owned } from '../contracts/testkit';
import { advanceTo } from '../sim';
import { devDisruption } from './disrupt';
import { aogDecision } from './events';
import { cancelCost, planHold, subcharterCost } from './flights';
import { resolveDecision } from '.';
import { setAogEnd, startAog } from './maintenance';
import { isRevenue } from './util';

const H = 60;
const leg = (g: GameState, ac: Aircraft, from: string, to: string, std: Minute, kind: Flight['kind'] = 'revenue') =>
  addFlight(g, { no: ownFlightNo(g), aircraftId: ac.id, contractId: null, kind, from, to, std, sta: std + blockMinutes(ac.typeId, from, to), ...(kind === 'revenue' ? { pax: 150 } : {}) });

/** Three legs in a row for one aircraft: LIS–LHR–LIS–FAO, each a turn after the last. */
function chain(seed: number) {
  const g = newGame(seed);
  const ac = Object.values(g.fleet)[0];
  const turn = typeOf(ac.typeId).turnMin;
  const t0 = g.now + 3 * H;
  const f1 = leg(g, ac, 'LIS', 'LHR', t0);
  const f2 = leg(g, ac, 'LHR', 'LIS', f1.sta + turn);
  const f3 = leg(g, ac, 'LIS', 'FAO', f2.sta + turn);
  g.now = t0;
  g.decisions.length = 0;
  return { g, ac, turn, f1, f2, f3 };
}

describe('v0.15.1 a curfew night stop moves the legs after it', () => {
  it('the next legs leave a turn after the night-stopped leg lands, not over it', () => {
    const { g, turn, f1, f2, f3 } = chain(5);
    expect(devDisruption(g, 'curfew', f1.id)).toBe(true);
    const d = g.decisions.find((x) => x.kind === 'curfew')!;
    expect(resolveDecision(g, d.id, 'night').ok).toBe(true);
    expect(f1.std).toBe(Number(d.data!.night));
    expect(f2.status).toBe('scheduled');
    expect(f2.std + f2.delay).toBeGreaterThanOrEqual(f1.sta + turn);
    if (f3.status === 'scheduled') expect(f3.std + f3.delay).toBeGreaterThanOrEqual(f2.sta + f2.delay + turn);
  });
});

/** An AOG at the gate of a signed charter day of three rotations LIS–OPO–LIS on the leased A320; the repair takes `hours`. */
function aogDay(seed: number, hours: number, otherBusy = false) {
  const g = newGame(seed);
  const ac = leased(g);
  const turn = typeOf(ac.typeId).turnMin;
  const blk = blockMinutes(ac.typeId, 'LIS', 'OPO');
  const t0 = Math.floor(g.now / DAY) * DAY + 3 * DAY + 7 * H;
  const plan: [string, string, Minute][] = [];
  let t = t0;
  for (let i = 0; i < 3; i++) {
    plan.push(['LIS', 'OPO', t], ['OPO', 'LIS', t + blk + turn]);
    t += 2 * (blk + turn) + 30;
  }
  const o = legsOffer(g, plan, 150);
  o.broker = undefined;
  const r = acceptOffer(g, o.id, [ac.id]);
  if (!r.ok) throw new Error(r.error);
  const legs = flightsOf(g, ac.id).filter((f) => f.contractId === r.data!.contractId && isRevenue(f));
  advanceTo(g, legs[0].std - 2, new Set());
  expect(ac.at).toBe('LIS');
  expect(ac.flightId).toBeNull();
  if (otherBusy) owned(g).status = 'maintenance';
  g.decisions.length = 0;
  startAog(g, ac, legs[0]);
  const m = g.maintenance[ac.maintId!];
  setAogEnd(g, m, g.now + hours * H);
  g.decisions.length = 0;
  aogDecision(g, ac, legs[0], m);
  return { g, ac, m, d: g.decisions.find((x) => x.kind === 'aog')!, legs };
}

describe('v0.15.1 the AOG default is the cheapest way out', () => {
  it('a free aircraft of the family is swapped in when the wait would drop legs', () => {
    const { g, d } = aogDay(21, 30);
    expect(Number(d.data!.cutC)).toBeGreaterThan(0);
    expect(d.options.find((o) => o.id === 'swap')!.tone).toBe('good');
    expect(d.defaultOption).toBe('swap');
    expect(resolveDecision(g, d.id, 'swap').ok).toBe(true);
  });

  it('with no aircraft free, the AOG team when its fee is less than the legs it saves', () => {
    const { g, ac, m, d } = aogDay(22, 30, true);
    expect(d.options.find((o) => o.id === 'swap')!.tone).toBe('bad');
    const lossC = cancelCost(g, planHold(g, ac, m.at, m.end + 30).cancels);
    const holdT = planHold(g, ac, m.at, Number(d.data!.teamEnd) + 30);
    const lossT = Number(d.data!.teamCost) + cancelCost(g, holdT.cancels) + subcharterCost(g, holdT.cancels, 1);
    expect(lossC).toBeGreaterThan(lossT);
    expect(['team', 'subcharter']).toContain(d.defaultOption);
    expect(resolveDecision(g, d.id, d.defaultOption).ok).toBe(true);
  });

  it('a short repair that drops nothing waits for the part as before', () => {
    const { d } = aogDay(23, 1, true);
    expect(Number(d.data!.cutC)).toBe(0);
    expect(d.defaultOption).toBe('courier');
  });
});
