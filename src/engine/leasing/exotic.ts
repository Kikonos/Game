// v0.17 player addition (UPDATE-0.17.md §T; rules lane `deals`, offers lane `supply`): exotic types (A380, 747-400/-8,
// the rare A340s, 747 classics) are hard and expensive, never impossible.
// - Rating B or better from any lessor; at C a lessor still deals with big security (4 more months' deposit and 3
//   months of minimum-hours reserves up front: credit.ts lessorStance, deals.ts exoticSecurityOf); at D no lease, but
//   a purchase (no credit check) is open to anyone with the cash.
// - The approvals, the AOC variation (4 + 4 rated pilots before its grant), the CAMO slots, the widebody total and each
//   lessor's cap still apply (a purchase counts against neither cap).
// - A request meeting every requirement has a floor chance of a proposal (rfp.ts aircraftChance).
// `exoticPath` says what it takes, one line a requirement, for the request and letter-of-intent dialogs. Pure.

import { BAL } from '../core/balance';
import { typeOf } from '../core/perf';
import type { CreditGrade, ExoticPath, GameState } from '../core/types';
import { aircraftGate, ratedPilots } from '../ops/company';
import { EX_OPERATORS } from '../../data/market';
import { LESSOR_DEFS } from '../../data/lessors';
import { gradeAtLeast, rating } from './credit';
import { familyOnAoc, needsVariation, variationCrew, variationQuote } from './aoc';
import { camoCapacity, camoFreeAt } from './induction';
import { fmtDay } from '../core/time';

const X = () => BAL.v017.exotic;

/** An exotic type (BAL.v017.exotic.types). Pure. */
export const isExotic = (typeId: string): boolean => X().types.includes(typeId);

/** What it takes to lease or buy one (§T); for any type, the same lines without the grade rule. Pure. */
export function exoticPath(g: GameState, typeId: string): ExoticPath {
  const t = typeOf(typeId);
  const exotic = isExotic(typeId);
  const classic = X().classics.includes(typeId);
  const steps: ExoticPath['steps'] = [];
  const r = rating(g);
  const minG = X().minGrade as CreditGrade;
  const secG = X().securityGrade as CreditGrade;
  if (exotic && !classic) {
    const ok = gradeAtLeast(r.grade, minG);
    steps.push({ key: 'grade', ok, text: `Lessor rating ${minG} or better to lease (now ${r.grade})` });
    if (!ok) {
      steps.push({
        key: 'security', ok: r.grade !== 'D' && gradeAtLeast(r.grade, secG),
        text: r.grade === 'D' ? `At D no lessor leases one: buy one with the cash instead${EX_OPERATORS[typeId]?.length ? ' (ask lessors: the airlines retiring them sell)' : ''}` : `At ${secG}: ${X().securityMonths} more months' deposit and ${X().reservesDepositMonths} months of reserves up front`,
      });
    }
  }
  const gate = aircraftGate(g, typeId);
  steps.push({ key: 'approvals', ok: gate.ok, text: gate.ok ? (gate.pending.length ? gate.text : 'Approvals held') : gate.text });
  const onAoc = familyOnAoc(g, t.family) || !needsVariation(g, t.family);
  const vq = onAoc ? null : variationQuote(g, t.family, typeId);
  steps.push({ key: 'aoc', ok: onAoc, text: onAoc ? `${t.family} on our AOC` : `An AOC variation for the ${t.family}${vq ? ` (${vq.days} days)` : ''}` });
  const need = exotic || !onAoc ? variationCrew(t.family) : BAL.v017.aoc.pilots;
  const p = ratedPilots(g, [t.family], { booked: true });
  steps.push({ key: 'crew', ok: p.CPT >= need.CPT && p.FO >= need.FO, text: `Rated pilots: ${p.CPT}/${need.CPT} captains, ${p.FO}/${need.FO} first officers` });
  const free = camoFreeAt(g, t.body === 'wide');
  steps.push({ key: 'camo', ok: free <= g.now + 1440, text: free <= g.now + 1440 ? `Our CAMO has room (${camoCapacity(g)} transition${camoCapacity(g) === 1 ? '' : 's'} at a time${t.body === 'wide' ? '; a widebody takes 2' : ''})` : `Our CAMO is busy until ${fmtDay(free)}` });
  const defs = LESSOR_DEFS.filter((l) => l.families.includes(t.family) && l.minGrade[t.body] !== null && l.id !== 'exop');
  const airlines = (EX_OPERATORS[typeId] ?? []).map((x) => x.airline);
  // Sources as lessor ids: the lessors holding the family, and the previous operator ('exop': airlines retiring them,
  // or for the 747 classics the owners selling them from storage).
  const sources = classic ? ['exop'] : [...defs.map((l) => l.id as string), ...(airlines.length ? ['exop'] : [])];
  const who = classic
    ? 'Sales from storage only'
    : `Who has them: ${[...defs.map((l) => l.name), ...(airlines.length ? ['airlines retiring them'] : [])].join(', ') || 'no one now'}`;
  steps.push({ key: 'source', ok: sources.length > 0, text: who });
  if (exotic) steps.push({ key: 'cash', ok: true, text: classic ? 'Bought with the cash: no lessor credit check' : 'Or buy one: no lessor credit check, the price in cash' });
  return { typeId, exotic, steps, sources };
}
