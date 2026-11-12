// Rotations round (v0.16.4): a deployment tour holds its crew for the whole rotation period, not only for the duties
// known so far (the programme's flights roll in 28 days ahead). Real ACMI practice: a crew set stays on station until
// its rotation ends (days off at the hotel), and goes home early only when a legal limit leaves no on-station answer.
// Pure helpers read by the roster (check.ts otherTrip, roster.ts fillPairing / sendHome / tourHomeTickets).

import { BAL } from '../core/balance';
import { DAY } from '../core/time';
import type { CrewMember, Deployment, GameState, Minute, Pairing } from '../core/types';
import { periodOf } from './duties';
import { crewIx, dhBlock, planHome, snapDeparture, type TicketPlan } from './timeline';
import { isAnnual, leaveTicketsOf } from './leaveTrips';

/** The deployment of a tour pairing. */
export const deploymentOf = (g: GameState, p: Pairing): Deployment | undefined => (p.tour && p.deploymentId ? g.deployments[p.deploymentId] : undefined);

/** The period a tour pairing's crew are committed to: the rotation period, cut at the deployment's end. */
export function tourSpan(g: GameState, p: Pairing): { from: Minute; to: Minute } | null {
  const dep = deploymentOf(g, p);
  if (!dep || !p.tour) return null;
  return { from: p.tour.from, to: Math.min(p.tour.to, dep.end) };
}

/** Two pairings are parts of one set's tour (a tour split into parts keeps set and period). */
export const sameTour = (p: Pairing, q: Pairing): boolean =>
  !!p.tour && !!q.tour && p.deploymentId === q.deploymentId && p.tour.set === q.tour.set && p.tour.from === q.tour.from;

/**
 * The period's last duty is known: its end (or the deployment's) lies inside the schedule horizon, so the roster can
 * book the ticket home after the real last duty. Before that the crew keep no ticket home (it would move every day).
 */
export function tourEndKnown(g: GameState, p: Pairing): boolean {
  const span = tourSpan(g, p);
  return !span || span.to <= g.now + (BAL.scheduleHorizonDays - 1) * DAY;
}

/**
 * The tour that keeps crew member c on station now: seated on a tour pairing whose period is under way and not over,
 * at its base, with work of that period still to come or its end not yet known. Null when they are free to go home
 * (the period is over, every known duty flown and the end known, a block ahead inside the period, or not at the base).
 */
export function tourHolding(g: GameState, c: CrewMember): Pairing | null {
  let hold: Pairing | null = null;
  for (const q of crewIx(g).pairingsOf.get(c.id) ?? []) {
    if (!q.tour || q.status === 'broken') continue;
    const dep = deploymentOf(g, q);
    const span = tourSpan(g, q);
    if (!dep || !span || c.loc !== dep.base) continue;
    if (span.from > g.now + DAY || span.to <= g.now + 12 * 60) continue;
    // (v0.17.2 a leave or course later in the period sends them home only when it is two days off, not weeks ahead.
    // v0.19.3 an annual leave with its own trip home on its first day does not: they stay on station until then.)
    if (c.blocks?.some((b) => b.from < Math.min(span.to, g.now + 2 * DAY) && b.to > g.now && !(isAnnual(b) && leaveTicketsOf(g, c, b, 'home').length))) continue;
    if (q.dutyIds.some((id) => { const d = g.duties[id]; return !!d && !d.done && d.report > g.now; }) || !tourEndKnown(g, q)) hold = q;
  }
  return hold;
}

/**
 * v0.22.1 (the player's CVE166: "there was crew at JED"): the tour station crew member c goes back to after a side trip.
 * A set on station flies other work from there between its own tour duties (the aircraft ferried away for another job
 * while the tour's legs are sub-leased) and returns to the station, not to home base, for the rest of its rotation.
 * `at`: where they are when the trip starts (before any ticket out); [from, to): the trip's duties. The station of a tour
 * of theirs whose period is under way over the whole trip, with work still to come (or its end not known yet). Pure.
 */
export function tourStationFor(g: GameState, c: CrewMember, p: Pairing, from: Minute, to: Minute, at: string): string | null {
  if (p.tour) return null;
  for (const q of crewIx(g).pairingsOf.get(c.id) ?? []) {
    if (!q.tour || q.status === 'broken' || q.id === p.id) continue;
    const dep = deploymentOf(g, q);
    const span = tourSpan(g, q);
    if (!dep || !span || dep.base !== at || span.from > from || span.to <= to) continue;
    if (!tourEndKnown(g, q) || q.dutyIds.some((id) => { const d = g.duties[id]; return !!d && !d.done && d.report >= to; })) return dep.base;
  }
  // The same between the duties of a trip of several days away from base (the cross-check on bot games: crew at an
  // outstation with two days to their trip's next duty read "busy" for a flight from there): back to where that next
  // duty leaves from, when that is where they are.
  if (at === c.base) return null;
  let next: { report: Minute; from: string } | null = null;
  for (const q of crewIx(g).pairingsOf.get(c.id) ?? []) {
    if (q.tour || q.status === 'broken' || q.status === 'done' || q.id === p.id) continue;
    for (const id of q.dutyIds) {
      const d = g.duties[id];
      if (!d || d.done || d.report < to || (next && next.report <= d.report)) continue;
      next = { report: d.report, from: g.flights[d.flightIds[0]]?.from ?? '' };
    }
  }
  return next && next.from === at ? at : null;
}

/**
 * v0.22.1 where crew member c goes after trip p: the tour station they came from (the seat's `backTo`, written when the
 * trip was planned, while a tour of theirs there is still on), else home base.
 */
export function homeOf(g: GameState, c: CrewMember, p: Pairing): string {
  const st = p.slots.find((s) => s.crewId === c.id)?.backTo;
  if (!st || st === c.base) return c.base;
  for (const q of crewIx(g).pairingsOf.get(c.id) ?? []) {
    if (!q.tour || q.status === 'broken') continue;
    const dep = deploymentOf(g, q);
    const span = tourSpan(g, q);
    if (dep && span && dep.base === st && span.to > g.now) return st;
  }
  return c.base;
}

/** Rotations round: how far into its period a set is, in whole days (for the Crew view and the inbox). */
export function tourDay(g: GameState, p: Pairing): { day: number; of: number } | null {
  const span = tourSpan(g, p);
  if (!span) return null;
  return { day: Math.max(1, Math.min(Math.ceil((g.now - span.from) / DAY), Math.round((span.to - span.from) / DAY))), of: Math.round((span.to - span.from) / DAY) };
}

/** Rotations round: one line per crew set on station, for the Crew view ("Set 2 at Hamburg: 23 of 35 days, home 7 Jun"). */
export interface SetLine {
  deploymentId: string;
  base: string;
  set: number;
  /** Day of the period (1-based) and its length in days. */
  day: number;
  of: number;
  /** When the set goes home: its earliest booked ticket home, else the period's end. */
  home: Minute;
  /** Crew seated on the set's tour now (0: not crewed yet). */
  crew: number;
  /** Crew who left the set early this period, with why and when. */
  early: { name: string; why: string; at: Minute }[];
}

export function deploymentSets(g: GameState): SetLine[] {
  const out: SetLine[] = [];
  const R = g.company.policies.rotationWeeks * 7 * DAY;
  const deps = Object.values(g.deployments).filter((d) => d.start <= g.now && d.end > g.now).sort((a, b) => a.base.localeCompare(b.base) || a.start - b.start);
  for (const dep of deps) {
    for (let s = 0; s < (dep.anchors?.length ?? dep.setsOnStation); s++) {
      // The period the set's own tour pairings carry when one runs now (an older save's tours keep the periods they
      // were rostered with), else the one the rotation gives today. A period with no tour pairing (no duty for the set)
      // is not shown: nobody is due on station.
      const mine = dep.pairingIds.map((id) => g.pairings[id]).filter((p): p is Pairing => !!p?.tour && p.tour.set === s && p.status !== 'broken');
      const now = mine.find((p) => p.tour!.from <= g.now && p.tour!.to > g.now)?.tour;
      const per = now ? { from: now.from, to: now.to } : periodOf(dep, s, g.now, R);
      if (!per) continue;
      const to = Math.min(per.to, dep.end);
      const parts = mine.filter((p) => p.tour!.from === per.from);
      if (!parts.length) continue;
      const ids = new Set<string>();
      const early: SetLine['early'] = [];
      for (const p of parts) {
        for (const sl of p.slots) {
          if (sl.crewId && g.crew[sl.crewId]) ids.add(sl.crewId);
          const c = sl.left ? g.crew[sl.left.crewId] : undefined;
          if (sl.left && c && sl.left.at >= per.from && !early.some((e) => e.name === `${c.first} ${c.last}`)) early.push({ name: `${c.first} ${c.last}`, why: sl.left.why, at: sl.left.at });
        }
      }
      let home = to;
      for (const id of ids) {
        for (const f of crewIx(g).tickets.get(id) ?? []) {
          if (f.kind === 'deadhead' && f.status === 'scheduled' && !f.leaveTrip && f.to === g.company.homeBase && f.std >= g.now && f.std < home) home = f.std;
        }
      }
      const of = Math.max(1, Math.round((to - per.from) / DAY));
      out.push({ deploymentId: dep.id, base: dep.base, set: s, day: Math.max(1, Math.min(of, Math.ceil((g.now - per.from) / DAY))), of, home, crew: ids.size, early });
    }
  }
  return out;
}

/**
 * Rotations round: the ticket home of a tour's crew. After the period's last duty when that duty is known (the period's
 * end lies inside the schedule horizon); else at the period's end: the set stays on station (days off at the hotel) for
 * the duties still to roll in, and the ticket is moved earlier once the last duty is known (roster.ts moveHome). Before,
 * it was booked after the last duty known at roster time, so a set on a thin programme flew home in the middle of its
 * rotation and a replacement was flown out when the next duty came.
 */
export function tourHomePlan(g: GameState, p: Pairing, last: { release: Minute; report: Minute; restAt: string; augment: number; ext?: boolean }, base: string, early = 0): TicketPlan {
  const plan = planHome(last as never, base, early);
  const span = tourSpan(g, p);
  if (!span || tourEndKnown(g, p)) return plan;
  const std = snapDeparture(last.restAt, base, Math.max(plan.std, Math.ceil((span.to - 12 * 60) / 60) * 60));
  return { from: last.restAt, to: base, std, sta: std + dhBlock(last.restAt, base) };
}
