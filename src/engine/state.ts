// Small helpers shared by the simulation and player actions.

import { AIRCRAFT_BY_ID } from '../data/aircraft';
import { AIRPORT_BY_CODE } from '../data/airports';
import { REGION_BY_ID } from '../data/regions';
import type { ExpCat, GameState, MonthFinance, Message, MsgCategory, MsgKind, RevCat } from './types';
import { EXP_CATS, REV_CATS } from './types';

export function newId(state: GameState, prefix: string): string {
  state.nextId += 1;
  return `${prefix}${state.nextId.toString(36)}`;
}

export function emptyMonth(key: number): MonthFinance {
  return {
    key,
    rev: Object.fromEntries(REV_CATS.map((c) => [c, 0])) as Record<RevCat, number>,
    exp: Object.fromEntries(EXP_CATS.map((c) => [c, 0])) as Record<ExpCat, number>,
    capex: 0,
    assetSales: 0,
    cashEnd: 0,
    pax: 0,
    flights: 0,
  };
}

export function earn(state: GameState, cat: RevCat, amount: number) {
  state.cash += amount;
  state.finance.current.rev[cat] += amount;
}

export function spend(state: GameState, cat: ExpCat, amount: number) {
  state.cash -= amount;
  state.finance.current.exp[cat] += amount;
}

/** A non-cash expense (e.g. depreciation). */
export function book(state: GameState, cat: ExpCat, amount: number) {
  state.finance.current.exp[cat] += amount;
}

export function capex(state: GameState, amount: number) {
  state.cash -= amount;
  state.finance.current.capex += amount;
}

export function message(
  state: GameState,
  kind: MsgKind,
  category: MsgCategory,
  title: string,
  body = '',
) {
  const m: Message = { id: newId(state, 'm'), day: state.day, kind, category, title, body, read: false };
  state.messages.unshift(m);
  if (state.messages.length > 250) state.messages.length = 250;
}

export function typeOf(typeId: string) {
  return AIRCRAFT_BY_ID[typeId];
}

export function isHub(state: GameState, code: string): boolean {
  return state.hubs.some((h) => h.code === code);
}

export function isRegionUnlocked(state: GameState, region: string): boolean {
  return state.unlockedRegions.includes(region);
}

export function isAirportUnlocked(state: GameState, code: string): boolean {
  return isRegionUnlocked(state, AIRPORT_BY_CODE[code].region);
}

export function homeContinent(state: GameState) {
  return REGION_BY_ID[state.airline.homeRegion].continent;
}

/** Airports served by at least one route (excluding hubs). */
export function stations(state: GameState): string[] {
  const set = new Set<string>();
  for (const r of state.routes) {
    if (!isHub(state, r.to)) set.add(r.to);
  }
  return [...set];
}

export function destinationsServed(state: GameState): string[] {
  const set = new Set<string>();
  for (const r of state.routes) {
    if (routeHasCapacity(state, r.id)) {
      set.add(r.to);
      set.add(r.from);
    }
  }
  return [...set];
}

export function routeHasCapacity(state: GameState, routeId: string): boolean {
  return state.fleet.some((a) => a.assignments.some((x) => x.routeId === routeId && x.freq > 0));
}

export function activeFleet(state: GameState) {
  return state.fleet.filter((a) => a.status !== 'delivering');
}

export function familiesInFleet(state: GameState): string[] {
  return [...new Set(state.fleet.filter((a) => a.status !== 'delivering').map((a) => AIRCRAFT_BY_ID[a.typeId].family))];
}
