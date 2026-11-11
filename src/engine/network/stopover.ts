// v0.21 stopover (tag) routes A–B–C (player report bmwbiobsokzf4: "a stopover where some passengers disembark and
// others embark and others stay to go on"). Three markets share one aircraft's seats: A–C through travellers (they sit
// on both sectors), A–B locals (first sector only) and B–C locals (second sector only, and only with fifth-freedom
// rights). Pure helpers: the sales, the departure and the business case all read the same split.

import type { RouteMarket } from '../../data/routes';
import { BAL } from '../core/balance';
import type { FifthRights } from './types';
import type { Dir } from './model';

export interface Pax { j: number; y: number }
export const NO_PAX: Pax = { j: 0, y: 0 };

/** The local markets of a direction's two sectors (each read in that direction): out A–B then B–C, back C–B then B–A. */
export function legMarkets(m: RouteMarket, dir: Dir): { first: RouteMarket; second: RouteMarket; bcSecond: boolean } | null {
  const so = m.stopover;
  if (!so) return null;
  return dir === 'out' ? { first: so.ab, second: so.bc, bcSecond: true } : { first: so.bc, second: so.ab, bcSecond: false };
}

/** The rights a route sells under: what the rights stage gave, else (before it) `assume`, else none. */
export const fifthOf = (r: { fifth?: FifthRights } | undefined, assume?: FifthRights): FifthRights => r?.fifth ?? assume ?? 'none';

/** Who wants business with no business cabin: a share flies economy with us, the rest goes elsewhere. */
export function foldJ(p: Pax, capJ: number): Pax {
  return capJ > 0 ? p : { j: 0, y: p.y + p.j * BAL.v019.demand.jToY };
}

/**
 * Through passengers sit on both sectors and are seated first (they pay for the whole way: revenue management keeps
 * their seats); each sector's locals fill what is left.
 */
function split(t: number, a: number, b: number, c1: number, c2: number): { t: number; a: number; b: number } {
  const tt = Math.max(0, Math.min(t, c1, c2));
  return { t: tt, a: Math.max(0, Math.min(a, c1 - tt)), b: Math.max(0, Math.min(b, c2 - tt)) };
}

export interface SeatSplit {
  thr: Pax;
  /** Locals on the first and the second sector of the direction. */
  l1: Pax;
  l2: Pax;
  /** Travellers who wanted a seat and found none (all three markets). */
  spill: number;
}

/**
 * v0.21 the seats of a stopover direction shared by the three markets (pure). `c1`/`c2` are the two sectors' seats by
 * class (economy already overbooked where allowed). B–C locals sit on the second sector out, the first back; limited
 * rights cap them at `bcMax` seats. Business wanters without a seat: some fly economy (the same market's), the rest
 * go elsewhere.
 */
export function shareSeats(thr: Pax, l1: Pax, l2: Pax, c1: Pax, c2: Pax, bcSecond: boolean, bcMax = Infinity): SeatSplit {
  const jToY = BAL.v019.demand.jToY;
  const capJ = Math.min(c1.j, c2.j);
  let T = foldJ(thr, capJ);
  let A = foldJ(l1, c1.j);
  let B = foldJ(l2, c2.j);
  // Limited fifth-freedom rights: the B–C locals capped at a share of the seats.
  const cap = (p: Pax): Pax => {
    const n = p.j + p.y;
    return n > bcMax ? { j: (p.j * bcMax) / n, y: (p.y * bcMax) / n } : p;
  };
  if (bcSecond) B = cap(B);
  else A = cap(A);
  const want = T.j + T.y + A.j + A.y + B.j + B.y;
  const sj = split(T.j, A.j, B.j, c1.j, c2.j);
  // Business wanters left over: a share flies economy (same market).
  T = { j: sj.t, y: T.y + (T.j - sj.t) * jToY };
  A = { j: sj.a, y: A.y + (A.j - sj.a) * jToY };
  B = { j: sj.b, y: B.y + (B.j - sj.b) * jToY };
  const sy = split(T.y, A.y, B.y, c1.y, c2.y);
  const out: SeatSplit = { thr: { j: T.j, y: sy.t }, l1: { j: A.j, y: sy.a }, l2: { j: B.j, y: sy.b }, spill: 0 };
  out.spill = Math.max(0, want - (out.thr.j + out.thr.y + out.l1.j + out.l1.y + out.l2.j + out.l2.y));
  return out;
}

/** The B–C locals' cap under limited rights (seats of the sector), else none. */
export function bcCapOf(fifth: FifthRights, seats: number): number {
  return fifth === 'limited' ? Math.floor(seats * BAL.v019.stop.limitedShare) : Infinity;
}

/** Zero the B–C locals when there are no rights (the stop is then for A's passengers only). */
export function gateBC(fifth: FifthRights, p: Pax): Pax {
  return fifth === 'none' ? NO_PAX : p;
}

/** Words for the rights. */
export const FIFTH_WORD: Record<FifthRights, string> = {
  full: 'B–C seats on sale', limited: `B–C seats capped at ${Math.round(BAL.v019.stop.limitedShare * 100)} % of the cabin`, none: 'no B–C seats: a stop for our own passengers only',
};
