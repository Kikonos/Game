// v0.16 candidates for a hire outside the department heads (a regional sales manager, the Compliance Monitoring
// Manager): three people (junior, mid, senior) from a side stream, deterministic per game, post and round, with names
// nobody in the company has yet. The shape is HeadCandidate so Team draws them like a head's candidates.

import { AIRPORT_BY_CODE } from '../../data/airports';
import { CREW_MIX, DEFAULT_MIX, NAMES } from '../../data/names';
import { int, next, range, weightedPick, type RngHolder } from '../core/rng';
import type { GameState, HeadCandidate } from '../core/types';
import { hash } from '../core/util';

const YEARS: [number, number][] = [[3, 7], [8, 14], [15, 26]];

/** Every name already in use: crew, heads and their candidates, the sales managers and the compliance manager. */
export function namesTaken(g: GameState): Set<string> {
  const taken = new Set(Object.values(g.crew).map((c) => `${c.first} ${c.last}`));
  for (const x of Object.values(g.heads ?? {})) {
    if (x?.hired) taken.add(x.hired.name);
    for (const k of x?.candidates ?? []) taken.add(k.name);
  }
  for (const r of g.com?.reps ?? []) taken.add(r.name);
  for (const list of Object.values(g.com?.repCandidates ?? {})) for (const k of list) taken.add(k.name);
  if (g.compliance?.hired) taken.add(g.compliance.hired.name);
  for (const k of g.compliance?.candidates ?? []) taken.add(k.name);
  return taken;
}

/**
 * Three candidates for a post: `tiers` as [skill lo, skill hi, salary ×] rows (BAL.v016 tables are [skill, ×]: the
 * skill varies ±0.05 around it), `salary` the mid tier's monthly pay, one blurb per tier. Pure in g (a side stream).
 */
export function rollPeople(g: GameState, key: string, tiers: [number, number][], salary: number, blurbs: string[]): HeadCandidate[] {
  const r: RngHolder = { rng: hash(`${g.seed}:people:${key}`) | 0 };
  const country = AIRPORT_BY_CODE[g.company.homeBase]?.country ?? '';
  const mix = CREW_MIX[country] ?? DEFAULT_MIX;
  const taken = namesTaken(g);
  return tiers.map(([skill, mult], i) => {
    let first = '';
    let last = '';
    for (let tries = 0; tries < 8 && (!first || taken.has(`${first} ${last}`)); tries++) {
      const nat = weightedPick(r, mix, ([, w]) => w)?.[0] ?? 'GB';
      const kit = NAMES[nat] ?? Object.values(NAMES)[0];
      const female = next(r) < 0.5;
      const firsts = female ? kit.f : kit.m;
      first = firsts[int(r, 0, firsts.length - 1)];
      const li = int(r, 0, kit.last.length - 1);
      last = female && kit.lastF ? kit.lastF[li] : kit.last[li];
    }
    taken.add(`${first} ${last}`);
    const yrs = YEARS[Math.min(i, YEARS.length - 1)];
    return {
      name: `${first} ${last}`, years: int(r, yrs[0], yrs[1]), skill: Math.round(Math.min(0.98, Math.max(0.3, skill + range(r, -0.05, 0.05))) * 100) / 100,
      salary: Math.round((salary * mult) / 100) * 100, blurb: blurbs[i % blurbs.length],
    };
  });
}
