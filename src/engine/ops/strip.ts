// v0.7.2 top bar ops strip (UPDATE-0.7.2.md F8): the live facts behind the warnings. Pure.

import { DAY, dayStart } from '../core/time';
import type { GameState, Minute } from '../core/types';
import { crewAway } from '../crew/away';
import { isRevenue } from './util';

export interface OpsStripFacts {
  /** Aircraft in the air, of the fleet on the AOC (not delivering / stored / leased out). */
  airborne: number;
  fleet: number;
  /** The next departure of our own aircraft. */
  next: { flightId: string; no: string; from: string; to: string; dep: Minute; aircraftId: string | null } | null;
  /** Revenue legs landed since 00:00 UTC and those on time (≤ 15 min late off blocks); null before the first landing. */
  onTime: { landed: number; onTime: number } | null;
  crewOnDuty: number;
  crewAtHotels: number;
  aog: { aircraftId: string; reg: string; at: string }[];
}

/** The strip's facts now. Pure. */
export function opsStripFacts(g: GameState): OpsStripFacts {
  let airborne = 0;
  let fleet = 0;
  const aog: OpsStripFacts['aog'] = [];
  for (const ac of Object.values(g.fleet)) {
    if (ac.status === 'delivering' || ac.status === 'stored' || ac.status === 'leasedOut') continue;
    fleet++;
    if (ac.status === 'flying' || (ac.flightId && g.flights[ac.flightId]?.status === 'enroute')) airborne++;
    if (ac.status === 'aog') aog.push({ aircraftId: ac.id, reg: ac.reg, at: ac.at });
  }
  const today = dayStart(g.now);
  let next: OpsStripFacts['next'] = null;
  let landed = 0;
  let onTime = 0;
  for (const f of Object.values(g.flights)) {
    if (f.kind === 'deadhead' || !f.aircraftId) continue;
    if (f.status === 'scheduled' && f.std >= g.now && f.std < g.now + 2 * DAY && (!next || f.std < next.dep || (f.std === next.dep && f.id < next.flightId))) {
      next = { flightId: f.id, no: f.no, from: f.from, to: f.to, dep: f.std, aircraftId: f.aircraftId };
    }
    if (f.status === 'done' && isRevenue(f) && (f.ata ?? f.sta) >= today && (f.ata ?? f.sta) <= g.now) {
      landed++;
      if ((f.atd ?? f.std) - f.std <= 15) onTime++;
    }
  }
  aog.sort((a, b) => (a.reg < b.reg ? -1 : 1));
  const away = crewAway(g);
  return { airborne, fleet, next, onTime: landed ? { landed, onTime } : null, crewOnDuty: away.onDuty, crewAtHotels: away.atHotels, aog };
}
