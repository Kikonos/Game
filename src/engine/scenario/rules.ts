// v0.15 Scenarios: what the player may do in each scenario (the player: "Everything not necessary for that scenario
// should be locked … I can just start the 747 Hajj airlift and just cancel all the contracts in play as a normal
// airline"). Locks are data: one `ScenarioRules` per scenario (scenario/defs.ts), read here by every action API
// (contracts, market, tenders, sales trips, fleet, refits, hiring, training, approvals, trip moves, sub-charters) so the
// store, dev, keyboard and bot paths are refused alike, and by the UI to show the action disabled with its reason.
// Deliberately light (types and airport data only): the engine modules that ask import it without a cycle. The rules
// themselves are registered by scenario/defs.ts when it loads (save.ts imports the scenario package).

import { AIRPORT_BY_CODE } from '../../data/airports';
import type { ApprovalId, Archetype, ContractOffer, GameState } from '../core/types';

/** Cancelling the scenario's core contracts: refused, allowed at the cost of the goal (the run ends, no stars), or as normal. */
export type CancelRule = 'locked' | 'penalty' | 'on';
/** Market offers: every kind, only the scenario's kinds (`themes`), or none. */
export type MarketRule = 'on' | 'themed' | 'off';
export type HireRule = 'none' | 'limited' | 'on';

export interface ScenarioRules {
  cancel: CancelRule;
  market: MarketRule;
  /** The kinds of work a 'themed' market offers (everything else never reaches the market). */
  themes?: Archetype[];
  /** Offers must touch the scenario's region (g.scen.region, Southern Winter). */
  region?: boolean;
  /** Tender board, trade fairs and sales trips. */
  tenders: boolean;
  sales: boolean;
  /** Leasing, buying, selling, returning early and dry-leasing out aircraft. */
  fleet: boolean;
  /** Cabin and crew-rest refits. */
  refits: boolean;
  hiring: HireRule;
  /** Crew members the board allows hired ('limited'). */
  hireMax?: number;
  /** Type ratings, conversions, command upgrades and SCCM courses. */
  training: boolean;
  /** Approvals (and the Ladder) that may be applied for; none when empty. */
  approvals: ApprovalId[];
  /** Moving a core contract's trips to another of our aircraft. */
  move: boolean;
  /** Handing legs to a rival (sub-charter). */
  subcharter: boolean;
  /** The scenario's reason in a few words, after "Not in this scenario: ". */
  why: string;
  /** Reasons per lock where the scenario's own reads better. */
  say?: Partial<Record<LockKey, string>>;
}

export type LockKey = 'cancel' | 'market' | 'tenders' | 'sales' | 'fleet' | 'refits' | 'hiring' | 'training' | 'approvals' | 'move' | 'subcharter';

/** Filled by scenario/defs.ts (id → rules). */
export const SCEN_RULES: Record<string, ScenarioRules> = {};

/** The running scenario's rules once it has been set up (its own setup signs and staffs freely); null in a normal game. */
export function rulesOf(g: GameState): ScenarioRules | null {
  const s = g.scen;
  if (!s || !s.core) return null;
  return SCEN_RULES[s.id] ?? null;
}

const PREFIX = 'Not in this scenario: ';

const DEFAULT_SAY: Record<LockKey, string> = {
  cancel: 'this contract is what the scenario is about',
  market: 'no other work this time',
  tenders: 'no tenders in this scenario',
  sales: 'no sales trips or fairs in this scenario',
  fleet: 'the fleet is fixed',
  refits: 'no refits in this scenario',
  hiring: 'no hiring in this scenario',
  training: 'no courses in this scenario',
  approvals: 'no new approvals in this scenario',
  move: 'these trips stay on their aircraft',
  subcharter: 'no hand-overs to rivals in this scenario',
};

const reason = (r: ScenarioRules, k: LockKey) => `${PREFIX}${r.say?.[k] ?? (k === 'cancel' || k === 'market' ? r.why : DEFAULT_SAY[k])}`;

/** A core contract: signed by the scenario's own setup (the job the scenario is about). Pure. */
export const isCore = (g: GameState, contractId: string): boolean => !!g.scen?.core?.includes(contractId);

/**
 * Why an action is refused in this scenario ("Not in this scenario: …"), or null when it may go ahead. Pure.
 * `ctx`: the contract (cancel, move), the archetype and airports of an offer (market), the approval, the crew count to
 * hire (hiring).
 */
export function lockOf(g: GameState, key: LockKey, ctx: { contractId?: string; archetype?: Archetype; airports?: string[]; approval?: ApprovalId; count?: number } = {}): string | null {
  const r = rulesOf(g);
  if (!r) return null;
  switch (key) {
    case 'cancel':
      return r.cancel === 'locked' && ctx.contractId && isCore(g, ctx.contractId) ? reason(r, key) : null;
    case 'move':
      return !r.move && ctx.contractId && isCore(g, ctx.contractId) ? reason(r, key) : null;
    case 'market': {
      // A dry lease out is a fleet change.
      if (ctx.archetype === 'dryLeaseOut' && !r.fleet) return reason(r, 'fleet');
      if (r.market === 'off') return reason(r, key);
      if (r.market === 'themed' && ctx.archetype && !(r.themes ?? []).includes(ctx.archetype)) return reason(r, key);
      if (r.region && ctx.airports && !inRegion(g, ctx.airports)) return `${PREFIX}${r.say?.market ?? 'only work in the region'}`;
      return null;
    }
    case 'approvals':
      return ctx.approval && r.approvals.includes(ctx.approval) ? null : !ctx.approval && r.approvals.length ? null : reason(r, key);
    case 'hiring': {
      if (r.hiring === 'on') return null;
      if (r.hiring === 'none') return reason(r, key);
      const left = hiresLeft(g) ?? 0;
      if (left <= 0) return `${PREFIX}${r.say?.hiring ?? `the board allowed ${r.hireMax ?? 0} hires and they are used`}`;
      if ((ctx.count ?? 1) > left) return `${PREFIX}only ${left} more hire${left === 1 ? '' : 's'} allowed (${r.hireMax} in all)`;
      return null;
    }
    default:
      return r[key] ? null : reason(r, key);
  }
}

/** Hires still allowed ('limited'), null when hiring is open or not a scenario. Pure. */
export function hiresLeft(g: GameState): number | null {
  const r = rulesOf(g);
  if (!r || r.hiring === 'on') return null;
  if (r.hiring === 'none') return 0;
  return Math.max(0, (r.hireMax ?? 0) - (g.scen?.hired ?? 0));
}

/** Counts crew hired in a scenario (the 'limited' allowance). */
export function noteHired(g: GameState, n: number): void {
  if (g.scen && rulesOf(g)) g.scen.hired = (g.scen.hired ?? 0) + n;
}

/** Whether any airport is in the scenario's region (its countries). Pure. */
export function inRegion(g: GameState, airports: string[]): boolean {
  const region = g.scen?.region;
  if (!region?.length) return true;
  return airports.some((a) => region.includes(AIRPORT_BY_CODE[a]?.country ?? ''));
}

/** The airports of an offer's programme (legs, or a base and its destinations). Pure. */
export function offerAirports(o: Pick<ContractOffer, 'pattern'>): string[] {
  const p = o.pattern;
  return p.kind === 'base' ? [p.base, ...p.dests] : p.legs.flatMap((l) => [l.from, l.to]);
}

/** Why an offer cannot be signed in this scenario (its kind or its region), or null. Pure. */
export function offerLock(g: GameState, o: Pick<ContractOffer, 'pattern' | 'archetype'>): string | null {
  return lockOf(g, 'market', { archetype: o.archetype, airports: offerAirports(o) });
}

/** v0.15 the market's weight of a kind of work in this scenario: 0 when the rules keep it off the market. Pure. */
export function themeWeight(g: GameState, a: Archetype): number {
  return lockOf(g, 'market', { archetype: a }) ? 0 : 1;
}

/**
 * v0.15.1 an approval a job needs that this scenario's rules never let us file for (one held, filed or allowed is fine),
 * else null. The market keeps such work off the desk: an aspirational ETOPS 120 job in Summer Surge pointed at a Ladder
 * the scenario had shut. Pure.
 */
export function unreachableApproval(g: GameState, req: { etops: number; approvals: readonly ApprovalId[] }): ApprovalId | null {
  const r = rulesOf(g);
  if (!r) return null;
  const have = (id: ApprovalId) => g.company.approvals.includes(id) || g.company.pendingApprovals.some((p) => p.id === id) || r.approvals.includes(id);
  for (const a of req.approvals) if (!have(a)) return a;
  if (req.etops > 0) {
    const fits = (['etops120', 'etops180', 'etops240'] as ApprovalId[]).filter((id) => Number(id.slice(5)) >= req.etops);
    if (fits.length && !fits.some(have)) return fits[0];
  }
  return null;
}

/** The warning on a 'penalty' cancel of a core contract ("the run ends with no stars"), else null. Pure. */
export function cancelWarning(g: GameState, contractId: string): string | null {
  const r = rulesOf(g);
  if (!r || r.cancel !== 'penalty' || !isCore(g, contractId)) return null;
  return `This is the contract the scenario is about: cancelling it ends the scenario with no stars (${r.say?.cancel ?? r.why}).`;
}

/** The rules in plain lines for the goals dialog: [what, allowed, detail]. Pure. */
export function rulesLines(g: GameState): { text: string; on: boolean }[] {
  const r = g.scen ? SCEN_RULES[g.scen.id] : undefined;
  if (!r) return [];
  const left = hiresLeft(g);
  const out: { text: string; on: boolean }[] = [];
  out.push({ text: r.cancel === 'locked' ? 'The scenario’s contracts cannot be cancelled' : r.cancel === 'penalty' ? 'Cancelling the scenario’s contract ends it with no stars' : 'Contracts you sign can be cancelled (penalties apply)', on: r.cancel === 'on' });
  out.push({ text: r.market === 'off' ? 'No new work from the market' : r.market === 'themed' ? `Market: ${r.region ? 'work in the region' : 'only this scenario’s kind of work'}` : 'Market open', on: r.market !== 'off' });
  out.push({ text: r.hiring === 'on' ? 'Hiring open' : r.hiring === 'limited' ? `Hiring: ${left ?? 0} of ${r.hireMax} hires left` : 'No hiring', on: r.hiring !== 'none' });
  if (r.training) out.push({ text: 'Training and conversions open', on: true });
  if (r.approvals.length) out.push({ text: 'Approvals the scenario needs can be filed', on: true });
  out.push({ text: r.subcharter ? 'Sub-charter to rivals allowed' : 'No sub-charter to rivals', on: r.subcharter });
  out.push({ text: r.refits ? 'Cabin and crew-rest refits allowed' : 'No refits', on: r.refits });
  out.push({ text: r.fleet ? 'Fleet changes allowed' : 'Fixed fleet: no leasing, buying, selling or dry lease out', on: r.fleet });
  out.push({ text: r.tenders || r.sales ? 'Tenders and sales trips open' : 'No tenders, fairs or sales trips', on: r.tenders || r.sales });
  return out;
}
