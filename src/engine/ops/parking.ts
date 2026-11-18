// v0.25 parking for an aircraft left on the ground away from base: a day's parking (BAL.delivery.parkPerDay, twice
// that at a slot-coordinated hub) through the ledger's airport fees, from its second day there. A night stop on a job
// is in the price; a client's base (a deployment) is the client's.

import { BAL } from '../core/balance';
import { flightsOf } from '../core/entities';
import { post } from '../core/ledger';
import { typeOf } from '../core/perf';
import { DAY } from '../core/time';
import type { Aircraft, GameState, Minute } from '../core/types';

/** Slot-coordinated hubs (IATA level 3) where a stand by the day costs about twice as much. */
const SLOT_HUBS = new Set(['LHR', 'LGW', 'CDG', 'ORY', 'FRA', 'MUC', 'AMS', 'FCO', 'MAD', 'BCN', 'DUS', 'ZRH', 'GVA', 'VIE', 'DUB', 'JFK', 'LGA', 'DCA', 'NRT', 'HND', 'DXB', 'SIN', 'HKG', 'IST']);

/** A day's parking for this type at this airport (dollars). Pure. */
export function parkPerDay(typeId: string, at: string): number {
  const base = BAL.delivery.parkPerDay[typeOf(typeId).body === 'wide' ? 1 : 0];
  return SLOT_HUBS.has(at) ? base * 2 : base;
}

/** Since when the aircraft has stood at its airport: its last landing there (or its delivery). Pure. */
function groundSince(g: GameState, ac: Aircraft): Minute {
  let since = ac.deliveredAt;
  for (const f of flightsOf(g, ac.id)) {
    if (f.to !== ac.at || f.status !== 'done') continue;
    since = Math.max(since, f.ata ?? f.sta);
  }
  return since;
}

/** The aircraft pays parking where it stands today (on the ground away from home and from a client's base a day or more). */
export function parksAt(g: GameState, ac: Aircraft): boolean {
  if (ac.status !== 'available' || ac.flightId || ac.at === g.company.homeBase || ac.returning || ac.sale) return false;
  // A delivery waiting for its pilots pays its own parking (delivery.ts).
  if (ac.delivery && !ac.delivery.arrived) return false;
  if (Object.values(g.deployments ?? {}).some((d) => d.base === ac.at && d.start <= g.now && g.now < d.end)) return false;
  return g.now - groundSince(g, ac) >= DAY;
}

/** Daily: a day's parking for each aircraft that stands away from base. */
export function dailyParking(g: GameState): void {
  for (const ac of Object.values(g.fleet)) if (parksAt(g, ac)) post(g, 'airportFees', -parkPerDay(ac.typeId, ac.at));
}
