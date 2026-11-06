// v0.17 player addition (UPDATE-0.17.md §T; rules lane `deals`, offers lane `supply`): exotic types (A380, 747-400/-8,
// the rare A340s, 747 classics) are hard and expensive, never impossible. `exoticPath` says what it takes, one line a
// requirement, for the request and letter-of-intent dialogs. Step 0: a pure read of the existing gates and our rating.

import { BAL } from '../core/balance';
import { typeOf } from '../core/perf';
import type { ExoticPath, GameState } from '../core/types';
import { aircraftGate, ratedPilots } from '../ops/company';
import { LESSOR_DEFS } from '../../data/lessors';
import { lessorRating } from './credit';
import { familyOnAoc } from './aoc';

const X = () => BAL.v017.exotic;
const RANK = { A: 0, B: 1, C: 2, D: 3 } as const;

/** An exotic type (BAL.v017.exotic.types). Pure. */
export const isExotic = (typeId: string): boolean => X().types.includes(typeId);

/** What it takes to lease or buy one (§T). Pure. */
export function exoticPath(g: GameState, typeId: string): ExoticPath {
  const t = typeOf(typeId);
  const exotic = isExotic(typeId);
  const steps: ExoticPath['steps'] = [];
  const r = lessorRating(g);
  const minG = X().minGrade as keyof typeof RANK;
  const secG = X().securityGrade as keyof typeof RANK;
  if (exotic) {
    const ok = RANK[r.grade] <= RANK[minG];
    steps.push({ key: 'grade', ok, text: `Lessor rating ${minG} or better (now ${r.grade})` });
    if (!ok) steps.push({ key: 'security', ok: RANK[r.grade] <= RANK[secG], text: `At ${secG}: ${X().securityMonths} more months' deposit and ${X().reservesDepositMonths} months of reserves up front` });
  }
  const gate = aircraftGate(g, typeId);
  steps.push({ key: 'approvals', ok: gate.ok, text: gate.ok ? 'Approvals held or filed' : gate.text });
  steps.push({ key: 'aoc', ok: familyOnAoc(g, t.family), text: familyOnAoc(g, t.family) ? `${t.family} on our AOC` : `An AOC variation for the ${t.family}` });
  const need = exotic ? X().crew : BAL.v017.aoc.pilots;
  const p = ratedPilots(g, [t.family], { booked: true });
  steps.push({ key: 'crew', ok: p.CPT >= need.CPT && p.FO >= need.FO, text: `Rated pilots: ${p.CPT}/${need.CPT} captains, ${p.FO}/${need.FO} first officers` });
  const sources = LESSOR_DEFS.filter((l) => l.families.includes(t.family) && l.minGrade[t.body] !== null).map((l) => l.id as string);
  steps.push({ key: 'source', ok: sources.length > 0, text: sources.length ? `Who has them: ${LESSOR_DEFS.filter((l) => sources.includes(l.id)).map((l) => l.name).join(', ')}` : 'No lessor leases this type' });
  return { typeId, exotic, steps, sources };
}
