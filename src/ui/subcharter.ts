// Player sub-charter (BRIEF core loop step 7): hand legs we can't or won't fly to a rival operator at their price;
// the client is still billed. Composed from ops' building blocks because the engine has no single player action
// for it yet. TODO(engine lane): replace with an ops action `subcharter(g, flightIds)` + a pure quote.

import { BAL } from '../engine/core/balance';
import { typeOf } from '../engine/core/perf';
import { DAY } from '../engine/core/time';
import type { ActionResult, Flight, GameState } from '../engine/core/types';
import { cancelCost, subcharterCost, subcharterLegs, unitOf } from '../engine/ops/flights';

const isRev = (f: Flight) => f.kind === 'revenue' || f.kind === 'techstop';
const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7) >>> 0;
/** Legs closer than this to departure can't be handed over any more. */
export const SUB_LEAD = 6 * 60;

export interface SubQuote {
  legs: Flight[];
  revenue: number;
  bh: number;
  rivalId: string;
  rivalName: string;
  cost: number;
  /** What cancelling the same legs would cost in compensation (for comparison). */
  cancel: number;
}

/** Our scheduled legs of a contract that can still be handed over (aircraft legs, not imminent). Pure. */
export function subcharterable(g: GameState, contractId: string): Flight[] {
  return Object.values(g.flights)
    .filter((f) => f.contractId === contractId && f.aircraftId && f.status === 'scheduled' && f.kind !== 'deadhead' && f.std + f.delay > g.now + SUB_LEAD)
    .sort((a, b) => a.std - b.std);
}

/** The rotation a leg belongs to (out and back to the station), still in the future. Pure. */
export function rotationOf(g: GameState, f: Flight): Flight[] {
  const ac = f.aircraftId ? g.fleet[f.aircraftId] : undefined;
  if (!ac) return [f];
  return unitOf(g, ac, f).filter((x) => x.status === 'scheduled' && x.std + x.delay > g.now + SUB_LEAD);
}

/** Price a rival asks for these legs (deterministic per contract, inside BAL.subcharterFactor). Pure. */
export function subcharterQuote(g: GameState, contractId: string, legs: Flight[]): SubQuote | null {
  const c = g.contracts[contractId];
  if (!c || !legs.length) return null;
  const ac = g.fleet[c.aircraftIds[0]];
  const fam = ac ? typeOf(ac.typeId).family : null;
  const fit = g.rivals.filter((r) => !fam || r.fleet.some((x) => typeOf(x.typeId).family === fam));
  const pool = fit.length ? fit : g.rivals;
  if (!pool.length) return null;
  const h = hash(contractId);
  const rival = pool[h % pool.length];
  const [lo, hi] = BAL.subcharterFactor;
  const factor = lo + ((h >>> 8) % 1000) / 1000 * (hi - lo) * 0.6;
  const rev = legs.filter(isRev);
  return {
    legs, revenue: rev.length, bh: rev.reduce((s, f) => s + f.block, 0) / 60, rivalId: rival.id, rivalName: rival.name,
    cost: subcharterCost(g, legs, factor), cancel: cancelCost(g, legs),
  };
}

/** Hands the quoted legs to the rival and posts the quoted cost. */
export function subcharter(g: GameState, q: SubQuote): ActionResult {
  const live = q.legs.filter((f) => g.flights[f.id] && f.status === 'scheduled' && f.std + f.delay > g.now + SUB_LEAD / 2);
  if (!live.some(isRev)) return { ok: false, error: 'Those legs have already left or changed' };
  const n = subcharterLegs(g, live, q.rivalId, q.cost);
  return { ok: true, msg: `${q.rivalName} flies ${n} leg${n > 1 ? 's' : ''} for us` };
}

/** Day buckets of legs (UTC days) for picking what to hand over on a base programme. Pure. */
export function legsByDay(legs: Flight[]): { day: number; legs: Flight[] }[] {
  const m = new Map<number, Flight[]>();
  for (const f of legs) {
    const d = Math.floor((f.std + f.delay) / DAY);
    const l = m.get(d);
    if (l) l.push(f);
    else m.set(d, [f]);
  }
  return [...m.entries()].sort((a, b) => a[0] - b[0]).map(([day, l]) => ({ day, legs: l }));
}
