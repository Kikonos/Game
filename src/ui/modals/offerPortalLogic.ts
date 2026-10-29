// v0.12 the offer dialog's schedule portal, pure parts (player request: "for contracts that have scheduled flights
// already I want it to show the flights so I know which ones I can swap and sublease"). The portal draws every
// scheduled flight of the aircraft as its own block at a scale where a flight reads as one (it scrolls sideways when
// the window is long); only work that has no flights yet stays one block (a base programme's days still to be
// generated, a dry lease, a delivery). The flights and programmes in the way of the new job are marked, and grouped
// into the trips the player can move to another aircraft or sub-lease (another operator flies it for us). No writes.

import { DAY } from '../../engine/core/time';
import type { FeasibilityReport } from '../../engine/contracts';
import type { ContractOffer, GameState, Minute } from '../../engine/core/types';
import { blockMinutes, planSector } from '../../engine/core/perf';
import { tripOf, type TripView } from '../../engine/ops/tripMove';
import { subleaseTrip, type SubleaseView } from '../../engine/ops/sublease';
import { rowBlocks, type GanttBlock } from '../screens/scheduleLogic';

/** A day is at least this wide (px): a 2 h leg is 10 px and an hour's turn 5 px, so flights never run together. */
export const PORTAL_PX_DAY = 120;

/** Inner width (px) of a portal of [from, to) in a box `box` px wide: the box, or wider (it scrolls). Pure. */
export function portalWidth(from: Minute, to: Minute, box: number): number {
  return Math.max(box, Math.ceil(((to - from) / DAY) * PORTAL_PX_DAY));
}

export type ClashReport = Pick<FeasibilityReport, 'conflicts'>;

export interface PortalBlock extends GanttBlock {
  /** In the way of the new job (red outline). */
  clash: boolean;
  /** A flight that can be picked (moved or sub-leased). */
  flightId: string | null;
}

/** Block kinds the portal draws: every flight, and one block only for work without flights (yet). */
const SHOWN = new Set<GanttBlock['kind']>(['flight', 'pos', 'maint', 'band', 'lease', 'cont', 'sub']);

/**
 * The portal's blocks for one aircraft: each scheduled flight on its own (never merged into day pills), a base
 * programme's ungenerated days as one 'cont' block, sub-chartered legs outlined. `clash` marks the trips in the way. Pure.
 */
export function portalBlocks(g: GameState, aircraftId: string, from: Minute, to: Minute, r?: ClashReport): PortalBlock[] {
  const legs = r ? clashLegs(g, r) : new Set<string>();
  const progs = new Set(r?.conflicts.programmes ?? []);
  const maint = new Set(r?.conflicts.maintenance ?? []);
  return rowBlocks(g, aircraftId, from, to).filter((b) => SHOWN.has(b.kind)).map((b) => {
    const ref = b.refs[0];
    const flightId = (b.kind === 'flight' || b.kind === 'pos') && ref?.kind === 'flight' ? ref.id : null;
    const clash = flightId ? legs.has(flightId)
      : b.kind === 'cont' || b.kind === 'lease' ? !!ref && ref.kind === 'contract' && progs.has(ref.id)
      : b.kind === 'maint' ? !!ref && maint.has(ref.id) : false;
    return { ...b, clash, flightId };
  });
}

export interface ClashTrip {
  /** Stable key: the trip's first leg. */
  key: string;
  /** A leg of it (the one the feasibility check found in the way). */
  flightId: string;
  /** 'LIS–FAO–LIS' and the flight numbers 'AWL120 · AWL121'. */
  label: string;
  nos: string;
  start: Minute;
  end: Minute;
  contractId: string | null;
  /** Every leg of the trip (for the red outline). */
  legIds: string[];
  move: TripView;
  sub: SubleaseView;
}

/** The trips of the aircraft's flights in the way of the new job (by departure), each once. Pure. */
export function clashTrips(g: GameState, r: ClashReport): ClashTrip[] {
  const out: ClashTrip[] = [];
  const seen = new Set<string>();
  for (const id of r.conflicts.flights) {
    if (seen.has(id) || !g.flights[id]) continue;
    const move = tripOf(g, id);
    const legs = move.legs.length ? move.legs : [g.flights[id]];
    for (const l of legs) seen.add(l.id);
    seen.add(id);
    const sub = subleaseTrip(g, id);
    const rev = legs.filter((l) => l.kind === 'revenue' || l.kind === 'techstop');
    out.push({
      key: legs[0].id, flightId: id, label: move.label || `${legs[0].from}–${legs[legs.length - 1].to}`,
      nos: [...new Set((rev.length ? rev : legs).map((l) => l.no))].join(' · '),
      start: legs[0].std + legs[0].delay, end: legs[legs.length - 1].sta + legs[legs.length - 1].delay,
      contractId: legs[0].contractId, legIds: legs.map((l) => l.id), move, sub,
    });
  }
  return out.sort((a, b) => a.start - b.start);
}

/** Every leg of the clashing trips (the red outlines). Pure. */
export function clashLegs(g: GameState, r: ClashReport): Set<string> {
  return new Set(clashTrips(g, r).flatMap((t) => t.legIds));
}

/** The clashing trips that can be sub-leased now, grouped by contract (one hand-over each). Pure. */
export function subleaseGroups(trips: ClashTrip[]): { contractId: string; trips: ClashTrip[]; flightIds: string[] }[] {
  const m = new Map<string, ClashTrip[]>();
  for (const t of trips) if (t.sub.ok && t.sub.contractId) m.set(t.sub.contractId, [...(m.get(t.sub.contractId) ?? []), t]);
  return [...m.entries()].map(([contractId, list]) => ({ contractId, trips: list, flightIds: [...new Set(list.flatMap((t) => t.sub.flightIds))] }));
}

/** v0.12 the offer's own flights drawn faintly on a candidate's timeline (dashed outline: not ours yet). */
export interface OfferGhost {
  key: string;
  start: Minute;
  end: Minute;
  /** 'rev' a flight the client asks for; 'pos' an empty leg this aircraft would need to get there or back. */
  kind: 'rev' | 'pos';
  label: string;
}

/** Ground time at a fuel stop between the legs of one revenue sector (as the flights are built). */
const TECH_STOP_MIN = 45;

/**
 * v0.12 player request: "I just want the block when there isn't any flights assigned. Everything else, I want the actual
 * flights on the timeline as a ghostly [outline]". The offer's revenue legs (fuel stops split a sector) at the client's
 * times, and this aircraft's positioning in and out from its feasibility report. A base programme has no legs yet:
 * none (the portal keeps the job block). Pure.
 */
export function offerGhosts(o: Pick<ContractOffer, 'pattern'>, typeId: string, report?: Pick<FeasibilityReport, 'positionIn' | 'positionOut'>): OfferGhost[] {
  if (o.pattern.kind !== 'legs') return [];
  const out: OfferGhost[] = [];
  for (const [i, l] of [...o.pattern.legs].sort((a, b) => a.dep - b.dep).entries()) {
    const sp = planSector(typeId, l.from, l.to);
    const legs = sp.ok && sp.legs.length ? sp.legs : [{ from: l.from, to: l.to, block: blockMinutes(typeId, l.from, l.to) }];
    let t = l.dep;
    for (const [j, x] of legs.entries()) {
      out.push({ key: `g${i}-${j}`, start: t, end: t + x.block, kind: 'rev', label: `${l.flightNo} ${x.from}–${x.to}` });
      t += x.block + TECH_STOP_MIN;
    }
  }
  for (const [k, p] of [...(report?.positionIn ?? []), ...(report?.positionOut ?? [])].entries()) {
    out.push({ key: `p${k}`, start: p.std, end: p.sta, kind: 'pos', label: `Empty ${p.from}–${p.to}` });
  }
  return out.sort((a, b) => a.start - b.start);
}
