// Named crew members (B2 owns; first version by the architect for the starting roster).

import type { RatingFamily } from '../../data/acmiTypes';
import { AIRPORT_BY_CODE } from '../../data/airports';
import { CREW_MIX, DEFAULT_MIX, NAMES } from '../../data/names';
import { BAL } from '../core/balance';
import { nextId } from '../core/entities';
import { chance, int, pick, weightedPick } from '../core/rng';
import type { CrewMember, CrewStatus, GameState, Role } from '../core/types';

const WIDE: RatingFamily[] = ['B757/767', 'A330/340', 'B777', 'B787', 'A350', 'A380', 'B747'];

export function salaryFor(role: Role, family: RatingFamily): number {
  const [n, w] = BAL.salary[role];
  return WIDE.includes(family) && family !== 'B757/767' ? w : n;
}

/** A new crew member at a base with a rating; names and languages follow the base's crew mix. */
export function makeCrewMember(g: GameState, role: Role, family: RatingFamily, base: string, status: CrewStatus = 'available'): CrewMember {
  const country = AIRPORT_BY_CODE[base]?.country ?? 'GB';
  const nat = weightedPick(g, CREW_MIX[country] ?? DEFAULT_MIX, (x) => x[1])![0];
  const kit = NAMES[nat] ?? NAMES.GB;
  const female = chance(g, role === 'CPT' || role === 'FO' || role === 'CRP' ? 0.18 : 0.72);
  const pilot = role === 'CPT' || role === 'FO' || role === 'CRP';
  const totalHours = role === 'CPT' ? int(g, 6_000, 15_000) : role === 'FO' ? int(g, 1_500, 5_500) : pilot ? int(g, 800, 2_500) : int(g, 500, 9_000);
  const [m0, m1] = BAL.startMorale;
  return {
    id: nextId(g, 'c'),
    first: pick(g, female ? kit.f : kit.m),
    last: pick(g, kit.last),
    nationality: nat,
    role,
    ratings: [family],
    languages: ['en', ...kit.langs],
    base,
    loc: base,
    status,
    restUntil: g.now,
    log: [],
    blockYear: 0,
    lastRecovery: g.now,
    awaySince: null,
    morale: int(g, m0, m1),
    fatigue: 0,
    salary: salaryFor(role, family),
    hired: g.now,
    discretion: 0,
    totalHours,
  };
}

export const crewName = (c: CrewMember) => `${c.first} ${c.last}`;
