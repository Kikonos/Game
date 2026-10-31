// v0.7.2 top bar ops strip (UPDATE-0.7.2.md F8): the live facts behind the warnings. Pure.

import { DAY, dayStart } from '../core/time';
import type { GameState, Minute } from '../core/types';
import { crewAway } from '../crew/away';
import { delayOf, onTimeLeg } from './latePolicy';
import { isRevenue } from './util';

export interface OpsStripFacts {
  /** Aircraft in the air, of the fleet on the AOC (not delivering / stored / leased out). */
  airborne: number;
  fleet: number;
  /** The next departure of our own aircraft: v0.12.1 its expected off-blocks (std + delay) and minutes behind schedule. */
  next: { flightId: string; no: string; from: string; to: string; dep: Minute; late: number; aircraftId: string | null } | null;
  /** Revenue legs landed since 00:00 UTC and those on time (≤ 15 min late off blocks against the schedule); null before the first landing. */
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
    // v0.12.1 a held leg is next at its expected time, not dropped once its old time has passed.
    const dep = f.std + f.delay;
    if (f.status === 'scheduled' && dep >= g.now && dep < g.now + 2 * DAY && (!next || dep < next.dep || (dep === next.dep && f.id < next.flightId))) {
      next = { flightId: f.id, no: f.no, from: f.from, to: f.to, dep, late: delayOf(f), aircraftId: f.aircraftId };
    }
    if (f.status === 'done' && isRevenue(f) && (f.ata ?? f.sta) >= today && (f.ata ?? f.sta) <= g.now) {
      landed++;
      // v0.12.1 against the schedule, not the moved time (a leg moved 2 h and flown on it was late).
      if (onTimeLeg(f)) onTime++;
    }
  }
  aog.sort((a, b) => (a.reg < b.reg ? -1 : 1));
  const away = crewAway(g);
  return { airborne, fleet, next, onTime: landed ? { landed, onTime } : null, crewOnDuty: away.onDuty, crewAtHotels: away.atHotels, aog };
}
