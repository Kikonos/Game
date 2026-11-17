// r3-fix route rotations an aircraft must give up for a C-check (booked, or forced when overdue). Real airlines cover a
// scheduled flight whose aircraft goes to the hangar: another aircraft of theirs, else a wet-leased one. So the
// rotations leave the aircraft (their flights removed, back to 'planned'), then each one is flown by another free
// aircraft, sub-chartered when it is close (no penalty, only the price), or left for the daily planner (a card at 10
// days out, a sub-charter at 3). Nothing is cancelled with EU261 just because the aircraft goes in for its check.

import { removeFlights } from '../core/entities';
import { fmtDayRange } from '../core/time';
import type { Flight, GameState, Minute } from '../core/types';
import { autoRoster } from '../crew/roster';
import { marketOfRoute } from './model';
import { pushRouteNote } from './notes';
import { candidates, flyRotation, subcharterRotation } from './timetable';
import type { Rotation, Route } from './types';

/** 'MLA–ESB' (the route's airports). */
const routeWord = (r: Route) => {
  const m = marketOfRoute(r);
  return m ? `${m.from}–${m.to}` : r.marketId.replace('-', '–');
};

/** A route flight its aircraft can hand over: our own, its whole rotation still on the ground. Pure. */
export function releasableRouteFlight(g: GameState, f: Flight): boolean {
  if (!f.sched || f.status !== 'scheduled' || f.operatedBy || !f.aircraftId) return false;
  const rot = g.network?.routes[f.sched.routeId]?.rotations.find((x) => x.id === f.sched!.rotId);
  if (!rot || rot.status !== 'flights' || rot.operatedBy || rot.aircraftId !== f.aircraftId) return false;
  return rot.sectors.every((s) => !s.accrued && !s.voided && (!s.flightId || g.flights[s.flightId]?.status === 'scheduled'));
}

/** Takes these flights' rotations off their aircraft (flights removed, the rotations planned again). Their ids. */
export function releaseRouteRotations(g: GameState, flights: Flight[]): string[] {
  const out: string[] = [];
  const ids: string[] = [];
  for (const f of flights) {
    if (!releasableRouteFlight(g, f)) continue;
    const rot = g.network!.routes[f.sched!.routeId].rotations.find((x) => x.id === f.sched!.rotId)!;
    if (out.includes(rot.id)) continue;
    out.push(rot.id);
    for (const s of rot.sectors) {
      if (s.flightId && g.flights[s.flightId]?.status === 'scheduled') ids.push(s.flightId);
      s.flightId = undefined;
    }
    rot.status = 'planned';
    rot.aircraftId = null;
  }
  if (ids.length) removeFlights(g, ids);
  return out;
}

/**
 * Covers released rotations: another free aircraft, else a sub-charter when it is within 3 days, else the daily
 * planner (materialise) carries on. One note a route, naming the check and how its flights fly.
 */
export function coverRotations(g: GameState, rotIds: string[], reg: string, from: Minute, to: Minute): void {
  if (!rotIds.length || !g.network) return;
  const byRoute = new Map<Route, { swapped: number; subbed: number; later: number }>();
  const touched = new Set<string>();
  for (const id of rotIds) {
    let route: Route | undefined;
    let rot: Rotation | undefined;
    for (const r of Object.values(g.network.routes)) {
      rot = r.rotations.find((x) => x.id === id);
      if (rot) {
        route = r;
        break;
      }
    }
    if (!route || !rot || rot.status !== 'planned') continue;
    const n = byRoute.get(route) ?? { swapped: 0, subbed: 0, later: 0 };
    byRoute.set(route, n);
    const ac = candidates(g, route, rot)[0];
    if (ac) {
      flyRotation(g, route, rot, ac);
      touched.add(ac);
      n.swapped++;
    } else if (rot.dep - g.now <= 3 * 24 * 60 && subcharterRotation(g, route, rot) > 0) n.subbed++;
    else n.later++;
  }
  if (touched.size) autoRoster(g, { aircraftIds: [...touched] });
  for (const [route, n] of byRoute) {
    const parts = [
      n.swapped ? `${n.swapped} fly on another of our aircraft` : '',
      n.subbed ? `${n.subbed} are sub-chartered` : '',
      n.later ? `${n.later} wait for an aircraft: free one, or each is sub-chartered 3 days before departure` : '',
    ].filter(Boolean);
    const total = n.swapped + n.subbed + n.later;
    pushRouteNote(g, route, n.later ? 'warn' : 'info', `${reg} C-check: ${total} ${routeWord(route)} round trip${total === 1 ? '' : 's'} moved`,
      `The check runs ${fmtDayRange(from, to)}. Of these round trips, ${parts.join(', ')}. Passengers keep their tickets.`, null);
  }
}
