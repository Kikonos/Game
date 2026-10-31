// v0.6 extra crew above the legal minimum: the effective setting for an aircraft / contract and the seats it adds
// to a complement (UPDATE-0.6.md §F4.1). Core imports only (duties.ts and hr.ts use it). Pure.

import { BAL } from '../core/balance';
import { complement, extraCabinRoom, isPilot } from '../core/perf';
import type { Contract, CrewExtra, GameState, Requirements, Role } from '../core/types';
import { clamp } from '../core/util';

export type CrewExtraSource = 'client' | 'contract' | 'aircraft' | 'company';
export type EffectiveExtra = CrewExtra & { source: CrewExtraSource; paidMin: number };

/**
 * The cabin extra locked on a contract whose client pays for extra cabin crew (0 when not taken): the paid crew
 * fly above the client's own required extra, so the lock is required + paid.
 */
export const paidMinOf = (k: Contract | undefined): number => (k?.extraPaid && k.requirements.extraCabinPaid ? k.requirements.extraCabin + k.requirements.extraCabinPaid.n : 0);

/**
 * Effective extra crew: cabin = max(client request, contract ?? aircraft ?? company default, paid minimum),
 * pilot = contract ?? aircraft ?? 0. Pure.
 */
export function crewExtraFor(g: GameState, aircraftId: string | null, contractId: string | null): EffectiveExtra {
  const ac = aircraftId ? g.fleet[aircraftId] : undefined;
  const k = contractId ? g.contracts[contractId] : undefined;
  const req = k?.requirements.extraCabin ?? 0;
  const paidMin = paidMinOf(k);
  let source: CrewExtraSource = k?.crewExtra ? 'contract' : ac?.crewExtra ? 'aircraft' : 'company';
  let cabin = k?.crewExtra?.cabin ?? ac?.crewExtra?.cabin ?? g.company.policies.extraCabin;
  cabin = Math.max(cabin, paidMin);
  if (req > 0 && req >= cabin) {
    cabin = req;
    source = 'client';
  }
  const pilot = (k?.crewExtra?.pilot ?? ac?.crewExtra?.pilot ?? 0) ? 1 : 0;
  cabin = clamp(Math.round(cabin), 0, Math.max(BAL.crewExtra.cabinMax, req));
  // v0.10 optional extras only up to the crew seats left; the client's required and paid crew fly regardless (beyond
  // the jump seats they take passenger seats: crewSeatsBlocked).
  if (ac) cabin = Math.min(cabin, Math.max(req, paidMin, req + extraCabinRoom(ac.typeId, ac.cabin.total, req)));
  return { cabin, pilot, source, paidMin };
}

/** v0.10 the most extra cabin crew an aircraft's crew seats take for this requirement (client extra included). */
export function extraCabinMax(g: GameState, aircraftId: string | null, req = 0): number {
  const ac = aircraftId ? g.fleet[aircraftId] : undefined;
  const room = ac ? extraCabinRoom(ac.typeId, ac.cabin.total, req) : BAL.crewExtra.cabinMax;
  return Math.max(req, Math.min(BAL.crewExtra.cabinMax, req + room));
}

/** Extra for an offer not yet signed on an aircraft (feasibility, quotes): client request vs the aircraft/company setting. */
export function offerExtra(g: GameState, aircraftId: string | null, req: Pick<Requirements, 'extraCabin'>, chosen?: CrewExtra): CrewExtra {
  const ac = aircraftId ? g.fleet[aircraftId] : undefined;
  const base = chosen ?? ac?.crewExtra ?? { cabin: g.company.policies.extraCabin, pilot: 0 as const };
  // v0.10 a default (not chosen) is capped by the crew seats; a chosen number (the client's paid option) is kept.
  const cabin = chosen ? base.cabin : Math.min(base.cabin, extraCabinMax(g, aircraftId, req.extraCabin));
  return { cabin: Math.max(req.extraCabin, cabin), pilot: base.pilot ? 1 : 0 };
}

export interface Seat {
  role: Role;
  /** Above the legal minimum (crew-extra settings): optional. */
  above: boolean;
  /** v0.12.1 a far base's reserve (crew/farBase.ts): above the minimum too. */
  reserve?: true;
}

/**
 * Seats of a complement: the legal minimum plus the client's required extra cabin crew (required), then the extra
 * cabin crew (CC) and the spare pilot (CRP) above it (optional). Pure.
 */
export function seatsFor(typeId: string, seats: number, x: CrewExtra, req: number, opts: { augment?: 0 | 1 | 2; restCabin?: number; pilotsOnly?: boolean } = {}): Seat[] {
  const roles = complement(typeId, seats, { augment: opts.augment, extraCabin: req, restCabin: opts.restCabin });
  const out: Seat[] = roles.filter((r) => !opts.pilotsOnly || isPilot(r)).map((role) => ({ role, above: false }));
  if (opts.pilotsOnly) return out;
  if (x.pilot) out.push({ role: 'CRP', above: true });
  for (let i = Math.max(0, x.cabin - req); i > 0; i--) out.push({ role: 'CC', above: true });
  return out;
}

/** Roles of a full complement with the extras (staffing, costs). */
export function rolesWithExtra(typeId: string, seats: number, x: CrewExtra, req = 0): Role[] {
  return seatsFor(typeId, seats, x, Math.min(req, x.cabin)).map((s) => s.role);
}
