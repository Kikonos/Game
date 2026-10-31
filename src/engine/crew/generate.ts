// Named crew members (B2 owns; first version by the architect for the starting roster).

import { ACMI_TYPES_LIST, type RatingFamily } from '../../data/acmiTypes';
import { AIRPORT_BY_CODE } from '../../data/airports';
import { CREW_MIX, DEFAULT_MIX, NAMES } from '../../data/names';
import { BAL } from '../core/balance';
import { nextId } from '../core/entities';
import { monthKey, yearOf } from '../core/time';
import { chance, int, next, pick, weightedPick } from '../core/rng';
import type { CrewMember, CrewStatus, GameState, Role } from '../core/types';

/** v0.12.1 families with a widebody type, and those that also have a narrowbody one (the B757/767). */
const bodies = (f: RatingFamily) => new Set(ACMI_TYPES_LIST.filter((t) => t.family === f).map((t) => t.body));

/**
 * Monthly salary of a role on a family: widebody pay on a widebody family, narrowbody pay on a narrowbody one.
 * v0.12.1 a family with both (the 757 and the 767) pays the widebody scale when `wideFlown` (a 767 in our fleet).
 */
export function salaryFor(role: Role, family: RatingFamily, wideFlown = false): number {
  const [n, w] = BAL.salary[role];
  const b = bodies(family);
  return b.has('wide') && (!b.has('narrow') || wideFlown) ? w : n;
}

/** v0.12.1 a widebody of this family in our fleet (the 767 of the B757/767 family, delivering included). Pure. */
export function wideOfFamilyInFleet(g: GameState, family: RatingFamily): boolean {
  for (const a of Object.values(g.fleet)) {
    const t = ACMI_TYPES_LIST.find((x) => x.id === a.typeId);
    if (t && t.family === family && t.body === 'wide') return true;
  }
  return false;
}

/**
 * v0.12.1 the salary of a role on a family in this company: B757/767 crews earn widebody pay while a 767 is in the
 * fleet (one pay scale for a combined 757/767 fleet, as airlines pay it), narrowbody pay on a 757-only fleet. Pure.
 */
export function payFor(g: GameState, role: Role, family: RatingFamily): number {
  return salaryFor(role, family, wideOfFamilyInFleet(g, family));
}

/** v0.12.1 a crew member's salary: the best-paid type they hold. Pure. */
export function crewPay(g: GameState, c: Pick<CrewMember, 'role' | 'ratings'>): number {
  let best = 0;
  for (const f of c.ratings) best = Math.max(best, payFor(g, c.role, f));
  return best || salaryFor(c.role, 'A320');
}

/** Surname, feminine form where the language has one (same RNG draw as a plain pick). */
function lastName(g: GameState, kit: (typeof NAMES)[string], female: boolean): string {
  const i = Math.floor(next(g) * kit.last.length);
  return (female && kit.lastF?.[i]) || kit.last[i];
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
  const firsts = female ? kit.f : kit.m;
  let first = pick(g, firsts);
  const last = lastName(g, kit, female);
  // No two crew share a full name: step through the first names (no extra RNG draws, so runs stay comparable).
  const taken = new Set(Object.values(g.crew).map((c) => `${c.first} ${c.last}`));
  for (let k = 1, i = firsts.indexOf(first); taken.has(`${first} ${last}`) && k < firsts.length; k++) first = firsts[(i + k) % firsts.length];
  return {
    id: nextId(g, 'c'),
    first,
    last,
    nationality: nat,
    role,
    ratings: [family],
    languages: ['en', ...kit.langs],
    base,
    loc: base,
    status,
    // Starting crew are rested (their last duty ended well before the game starts).
    restUntil: g.now - 12 * 60,
    log: [],
    blockYear: 0,
    blockYearOf: yearOf(g.now),
    lastRecovery: g.now - 12 * 60,
    awaySince: null,
    morale: int(g, m0, m1),
    fatigue: 0,
    salary: payFor(g, role, family),
    hired: g.now,
    discretion: 0,
    totalHours,
    // v0.7.3 two local days twice a month: tracked from the month they join.
    twoDays: { 0: monthKey(g.now) },
  };
}

export const crewName = (c: CrewMember) => `${c.first} ${c.last}`;
