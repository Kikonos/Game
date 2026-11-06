// v0.17 "Aircraft market" (UPDATE-0.17.md §B; data owned by lane `supply`, rules in lane `deals`): the real lessors
// we can ask for aircraft, with what they really lease as far as the research supports it
// (/home/user/work/v017/research-supply.md, research-terms.md §3), plus the previous operator selling or leasing direct.
//
// - ages: the age bands each places; families: the type families it leases;
// - minGrade: the lowest lessor rating it deals at, narrowbody / widebody (null: it does not lease that body);
// - caps: how many aircraft it places with us at each grade (`wide` of those may be widebodies);
// - appetite: the chance it has an aircraft for a request at tightness 0, before the other factors (§D.3);
// - names: the strings older saves carry on their leases (Ownership.lessor), for lessorIdOf.
//
// Player addition (§T): exotic types (A380, 747s, the rare A340s) are hard and expensive, never impossible. Doric and
// Amedeo hold end-of-life A380s; airlines retiring their A380s and 747s lease or sell them direct (`exop`). The grade
// and security rule for exotics is BAL.v017.exotic.

import type { RatingFamily } from './acmiTypes';
import type { AgeBand, CreditGrade, LessorId } from '../engine/core/types';

export type LessorTier = 'top' | 'mid' | 'midLife' | 'endOfLife' | 'assetManager' | 'specialist' | 'airline';

export interface LessorDef {
  id: LessorId;
  name: string;
  tier: LessorTier;
  ages: AgeBand[];
  families: RatingFamily[];
  minGrade: { narrow: CreditGrade | null; wide: CreditGrade | null };
  /** Aircraft placed with us in all, by our grade; `wide`: how many of those may be widebodies. */
  caps: Record<CreditGrade, { all: number; wide: number }>;
  appetite: { narrow: number | null; wide: number | null };
  /** Names on older saves' leases (Ownership.lessor); the first is the display name. */
  names: string[];
  /** One line for the tooltip (a newer trading name, what it is known for). */
  note?: string;
}

const C = (a: [number, number], b: [number, number], c: [number, number], d: [number, number]): LessorDef['caps'] => ({
  A: { all: a[0], wide: a[1] }, B: { all: b[0], wide: b[1] }, C: { all: c[0], wide: c[1] }, D: { all: d[0], wide: d[1] },
});

const NB: RatingFamily[] = ['A320', 'B737'];

/** UPDATE-0.17.md §B, in the table's order (Amedeo added for the exotic path, §T). */
export const LESSOR_DEFS: LessorDef[] = [
  {
    id: 'aercap', name: 'AerCap', tier: 'top', ages: ['new', 'young', 'mid'], families: [...NB, 'A330/340', 'B777', 'B787', 'A350'],
    minGrade: { narrow: 'B', wide: 'B' }, caps: C([5, 2], [3, 1], [0, 0], [0, 0]), appetite: { narrow: 0.9, wide: 0.6 }, names: ['AerCap'],
    note: 'The largest lessor: about 300 customers, none above 10 % of its revenue',
  },
  {
    id: 'smbc', name: 'SMBC Aviation Capital', tier: 'top', ages: ['new', 'young', 'mid'], families: NB,
    minGrade: { narrow: 'B', wide: null }, caps: C([4, 0], [2, 0], [0, 0], [0, 0]), appetite: { narrow: 0.9, wide: null }, names: ['SMBC Aviation Capital'],
  },
  {
    id: 'avolon', name: 'Avolon', tier: 'top', ages: ['new', 'young', 'mid'], families: [...NB, 'A330/340', 'B787', 'A350'],
    minGrade: { narrow: 'B', wide: 'B' }, caps: C([4, 2], [2, 1], [0, 0], [0, 0]), appetite: { narrow: 0.85, wide: 0.5 }, names: ['Avolon'],
  },
  {
    id: 'alc', name: 'Air Lease Corporation', tier: 'top', ages: ['new', 'young', 'mid'], families: [...NB, 'A330/340', 'B777', 'B787', 'A350'],
    minGrade: { narrow: 'B', wide: 'B' }, caps: C([4, 2], [2, 1], [0, 0], [0, 0]), appetite: { narrow: 0.85, wide: 0.5 }, names: ['Air Lease Corporation'],
    note: 'Now trading as Sumisho Air Lease',
  },
  {
    id: 'boc', name: 'BOC Aviation', tier: 'top', ages: ['new', 'young', 'mid'], families: [...NB, 'A330/340', 'B777', 'B787', 'A350'],
    minGrade: { narrow: 'B', wide: 'B' }, caps: C([3, 2], [2, 1], [0, 0], [0, 0]), appetite: { narrow: 0.8, wide: 0.45 }, names: ['BOC Aviation'],
  },
  {
    id: 'cdb', name: 'CDB Aviation', tier: 'top', ages: ['young', 'mid'], families: [...NB, 'A330/340', 'B787'],
    minGrade: { narrow: 'B', wide: 'B' }, caps: C([3, 1], [2, 1], [0, 0], [0, 0]), appetite: { narrow: 0.7, wide: 0.35 }, names: ['CDB Aviation'],
  },
  {
    id: 'acg', name: 'Aviation Capital Group', tier: 'mid', ages: ['young', 'mid'], families: [...NB, 'B787'],
    minGrade: { narrow: 'C', wide: 'B' }, caps: C([4, 1], [3, 1], [1, 0], [0, 0]), appetite: { narrow: 0.8, wide: 0.3 }, names: ['Aviation Capital Group'],
  },
  {
    id: 'aircastle', name: 'Aircastle', tier: 'midLife', ages: ['mid', 'old'], families: [...NB, 'A330/340', 'B777'],
    minGrade: { narrow: 'C', wide: 'C' }, caps: C([4, 2], [3, 1], [2, 1], [0, 0]), appetite: { narrow: 0.75, wide: 0.45 }, names: ['Aircastle'],
  },
  {
    id: 'carlyle', name: 'Carlyle Aviation Partners', tier: 'midLife', ages: ['mid', 'old'], families: [...NB, 'B757/767', 'A330/340', 'B777'],
    minGrade: { narrow: 'C', wide: 'C' }, caps: C([4, 2], [3, 1], [2, 1], [1, 0]), appetite: { narrow: 0.75, wide: 0.45 }, names: ['Carlyle Aviation Partners'],
  },
  {
    id: 'vallair', name: 'Vallair', tier: 'endOfLife', ages: ['old'], families: NB,
    minGrade: { narrow: 'D', wide: null }, caps: C([3, 0], [3, 0], [3, 0], [1, 0]), appetite: { narrow: 0.8, wide: null }, names: ['Vallair'],
    note: 'End-of-life specialist: old A320s and 737s, short leases, big deposits',
  },
  {
    id: 'doric', name: 'Doric', tier: 'assetManager', ages: ['young', 'mid', 'old'], families: ['B777', 'B787', 'A350', 'A380'],
    minGrade: { narrow: null, wide: 'B' }, caps: C([2, 2], [1, 1], [0, 0], [0, 0]), appetite: { narrow: null, wide: 0.4 }, names: ['Doric'],
    note: 'Asset manager for widebody funds, A380s among them',
  },
  {
    id: 'amedeo', name: 'Amedeo', tier: 'specialist', ages: ['mid', 'old'], families: ['A380'],
    minGrade: { narrow: null, wide: 'B' }, caps: C([2, 2], [2, 2], [1, 1], [0, 0]), appetite: { narrow: null, wide: 0.35 }, names: ['Amedeo'],
    note: 'A380 specialist (Dublin): A380s back from airlines, placed with charter and ACMI operators',
  },
  {
    id: 'exop', name: 'The previous operator', tier: 'airline', ages: ['old'], families: ['B747', 'A330/340', 'B757/767', 'A380'],
    minGrade: { narrow: 'C', wide: 'C' }, caps: C([2, 2], [2, 2], [1, 1], [0, 0]), appetite: { narrow: 0.5, wide: 0.3 }, names: [],
    note: 'An airline retiring the type leases or sells its own aircraft (caps per airline)',
  },
];

export const LESSOR_BY_ID: Record<LessorId, LessorDef> = Object.fromEntries(LESSOR_DEFS.map((l) => [l.id, l])) as Record<LessorId, LessorDef>;

/**
 * The lessor id of a lease's lessor name (older saves carry names, not ids): 'AerCap' → 'aercap'. A '(used sale)'
 * seller is not a lessor (null); an unknown name is null too. Pure.
 */
export function lessorIdOf(name: string | undefined | null): LessorId | null {
  if (!name || /\(used sale\)/.test(name)) return null;
  const n = name.trim().toLowerCase();
  for (const l of LESSOR_DEFS) if (l.names.some((x) => x.toLowerCase() === n) || l.name.toLowerCase() === n) return l.id;
  return null;
}
