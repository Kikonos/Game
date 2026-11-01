// v0.14 crew sets in plain words (Crew › People strip, Planning cards, the crew card): one sentence per fleet, a dual-rated
// person's home fleet, and the three lines behind a card's "i". Pure.

import type { RatingFamily } from '../../data/acmiTypes';
import { BAL } from '../../engine/core/balance';
import type { Role } from '../../engine/core/types';
import type { FamilyPlan } from '../../engine/crew';

const SHORT: Record<RatingFamily, string> = {
  A320: 'A320', B737: '737', 'B757/767': '757/767', 'A330/340': 'A330', B777: '777', B787: '787', A350: 'A350', A380: 'A380', B747: '747',
};

/** A fleet's short name as crews say it ('A320', 'A330', '737'); the A330/340 rating reads 'A340' for an A340-only fleet. */
export function fleetShort(f: RatingFamily, typeIds: string[] = []): string {
  if (f === 'A330/340' && typeIds.length && typeIds.every((t) => t.startsWith('a34'))) return 'A340';
  return SHORT[f] ?? f;
}

const ROLE_WORDS: Record<Role, [string, string]> = {
  CPT: ['captain', 'captains'], FO: ['first officer', 'first officers'], CRP: ['relief pilot', 'relief pilots'], PUR: ['purser', 'pursers'], CC: ['cabin crew', 'cabin crew'],
};
/** '6 cabin crew', '1 captain', '2 first officers'. */
export const roleCount = (role: Role, n: number) => `${n} ${ROLE_WORDS[role][n === 1 ? 0 : 1]}`;

/**
 * v0.14 the strip's one sentence for a fleet: 'A320: 2 of 5 full crews · short 6 cabin crew', or complete:
 * 'A320: 25 of 25 full crews · 6 spare' (· 3 joining when some only exist once joiners start).
 */
export function planSentence(p: Pick<FamilyPlan, 'family' | 'types' | 'setsNeeded' | 'setsComplete' | 'setsNow' | 'roles'>): string {
  const name = fleetShort(p.family, p.types.map((t) => t.typeId));
  const of = Math.min(p.setsComplete, p.setsNeeded);
  const parts = [`${name}: ${of} of ${p.setsNeeded} full crew${p.setsNeeded === 1 ? '' : 's'}`];
  if (p.setsComplete < p.setsNeeded) {
    const miss = p.roles.filter((r) => r.balance < 0).map((r) => roleCount(r.role, -r.balance));
    if (miss.length) parts.push(`short ${miss.join(', ')}`);
  } else if (p.setsComplete > p.setsNeeded) parts.push(`${p.setsComplete - p.setsNeeded} spare`);
  const joining = Math.max(0, of - p.setsNow);
  if (joining) parts.push(`${joining} joining`);
  return parts.join(' · ');
}

/**
 * v0.14 a person's fleets on their card: the home fleet (where the sets count them) and any others in brackets,
 * 'A320 (also A330)'; an Airbus CCQ pilot counted on the A330 reads 'A330 (also A320)'. `home`: the family the sets
 * count them in (crewSupply's homes), else their first rating. Pure.
 */
export function ratingLine(ratings: RatingFamily[], home?: RatingFamily, fleetTypes: string[] = []): string {
  if (!ratings.length) return 'no rating';
  const h = home && ratings.includes(home) ? home : ratings[0];
  const others = ratings.filter((f) => f !== h);
  const name = (f: RatingFamily) => fleetShort(f, fleetTypes.filter((t) => familyOfType(t) === f));
  return others.length ? `${name(h)} (also ${others.map(name).join(', ')})` : name(h);
}

/** Rough family of a type id for the A330/A340 split (only the a33x / a34x ids matter here). */
const familyOfType = (t: string): RatingFamily | null => (t.startsWith('a33') || t.startsWith('a34') ? 'A330/340' : null);

/**
 * v0.14 the sets card's "i": three short lines: why N per aircraft, what limits the full crews, who fills which seats.
 */
export function setsWhyLines(p: Pick<FamilyPlan, 'setsPerAircraft' | 'limiting'> & { augmented?: boolean }): [string, string, string] {
  const n = p.setsPerAircraft;
  const why = n > BAL.crewSetsPerAircraft
    ? `${n} crews per aircraft: on a detachment, its crews on station plus one in five for leave and change-overs.`
    : `${n} crews per aircraft: everyone has 8–10 days off a month and 4 weeks’ leave, so it takes about ${n} to keep one aircraft flying.`;
  const limit = `The role you have fewest of sets how many full crews you have${p.limiting ? `: here, ${ROLE_WORDS[p.limiting][1]}` : ''}.`;
  const seats = `A captain can’t be planned as first officer; spare pursers fill cabin crew seats${p.augmented ? ' and spare first officers relief seats' : ''}; dual-rated crew count once, in their home fleet.`;
  return [why, limit, seats];
}
