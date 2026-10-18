import { ArrowRight } from 'lucide-react';
import { AIRCRAFT_BY_ID } from '../../data/aircraft';
import { AIRPORT_BY_CODE } from '../../data/airports';
import { flag } from '../../data/countries';
import { REGION_BY_ID } from '../../data/regions';
import { CLASSES } from '../../data/seats';
import { cabinSeats, cabinSummary, totalSeats } from '../../engine/cabin';
import { MAX_WEEKLY_HOURS } from '../../engine/economy';
import { hoursUsed } from '../../engine/actions';
import type { Aircraft, GameState, Route } from '../../engine/types';

export function AirportTag({ code, city = true }: { code: string; city?: boolean }) {
  const a = AIRPORT_BY_CODE[code];
  return (
    <span className="ap-tag">
      <span className="code">{code}</span>
      {city && <span className="ap-city">{flag(a.country)} {a.city}</span>}
    </span>
  );
}

export function RouteTag({ r, city = true }: { r: Pick<Route, 'from' | 'to'>; city?: boolean }) {
  return (
    <span className="route-tag">
      <AirportTag code={r.from} city={false} />
      <ArrowRight size={13} className="dim" />
      <AirportTag code={r.to} city={false} />
      {city && <span className="ap-city">{AIRPORT_BY_CODE[r.from].city} – {AIRPORT_BY_CODE[r.to].city}</span>}
    </span>
  );
}

export interface WeekStats {
  pax: number;
  seats: number;
  lf: number;
  rev: number;
  cost: number;
  profit: number;
  conn: number;
}

export function routeWeek(r: Route): WeekStats | null {
  const w = r.history[r.history.length - 1];
  if (!w) {
    if (!r.last) return null;
    const pax = (r.last.pax.F + r.last.pax.J + r.last.pax.W + r.last.pax.Y) * 7;
    const seats = (r.last.seats.F + r.last.seats.J + r.last.seats.W + r.last.seats.Y) * 7;
    return { pax, seats, lf: seats ? pax / seats : 0, rev: r.last.rev * 7, cost: r.last.cost * 7, profit: (r.last.rev - r.last.cost) * 7, conn: r.last.connPax * 7 };
  }
  return { pax: w.pax, seats: w.seats, lf: w.seats ? w.pax / w.seats : 0, rev: w.rev, cost: w.cost, profit: w.rev - w.cost, conn: w.connPax };
}

export function routeAircraft(g: GameState, routeId: string): { ac: Aircraft; freq: number }[] {
  const out: { ac: Aircraft; freq: number }[] = [];
  for (const ac of g.fleet) for (const a of ac.assignments) if (a.routeId === routeId) out.push({ ac, freq: a.freq });
  return out;
}

export function routeFreq(g: GameState, routeId: string): number {
  return routeAircraft(g, routeId).reduce((s, x) => s + x.freq, 0);
}

export function aircraftStatus(g: GameState, ac: Aircraft): { label: string; tone: 'good' | 'warn' | 'bad' | 'info' | '' } {
  const days = Math.max(0, ac.statusUntil - g.day);
  switch (ac.status) {
    case 'delivering': return { label: `Delivery in ${days}d`, tone: 'info' };
    case 'maintenance': return { label: `In hangar · ${days}d`, tone: 'warn' };
    case 'refit': return { label: `Cabin refit · ${days}d`, tone: 'warn' };
    case 'ferry': return { label: `Ferry flight · ${days}d`, tone: 'info' };
    default:
      if (ac.lastDisruption === g.day) return { label: 'Grounded today', tone: 'bad' };
      if (!ac.assignments.some((a) => a.freq > 0)) return { label: 'Idle', tone: 'bad' };
      return { label: 'Flying', tone: 'good' };
  }
}

export function utilization(g: GameState, ac: Aircraft): number {
  return hoursUsed(ac, g) / MAX_WEEKLY_HOURS;
}

export function seatsLabel(ac: Aircraft): string {
  const s = cabinSeats(AIRCRAFT_BY_ID[ac.typeId], ac.cabin);
  return `${totalSeats(s)} seats · ${cabinSummary(s)}`;
}

export function hasClass(ac: Aircraft) {
  const s = cabinSeats(AIRCRAFT_BY_ID[ac.typeId], ac.cabin);
  return CLASSES.filter((c) => s[c] > 0);
}

export function lfTone(lf: number): 'good' | 'warn' | 'bad' {
  return lf >= 0.75 ? 'good' : lf >= 0.55 ? 'warn' : 'bad';
}

export function mapRotate(g: GameState): number {
  return REGION_BY_ID[g.airline.homeRegion].continent === 'OC' ? -150 : 0;
}
