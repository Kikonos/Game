// v0.7.2 C-checks at real MRO hubs (UPDATE-0.7.2.md §7): a ferry out, the check, a ferry home; the pilots fly home
// and back on airline tickets in between (rostered by the auto-roster like any ferry).

import type { CHub } from '../../data/mro';
import type { ActionResult, Flight, GameState, Minute } from '../core/types';
import type { DeliveryLeg } from './delivery';

export interface CCheckOption {
  hub: CHub;
  ok: boolean;
  why: string | null;
  /** The check in the hangar. */
  start: Minute;
  end: Minute;
  ferryOut: DeliveryLeg[];
  ferryHome: DeliveryLeg[];
  checkCost: number;
  /** Fuel and fees both ways. */
  ferryCost: number;
  /** Two pilots: airline tickets home and back out, hotels. */
  crewCost: number;
  total: number;
  /** Ferry out → ferry home landed. */
  awayDays: number;
}

export interface CheckTicket { crewIds: string[]; no: string; from: string; to: string; dep: Minute; cost: number }

/** One option per hub of the aircraft's family, cheapest total first. Pure. */
export function cCheckOptions(g: GameState, aircraftId: string, start?: Minute): CCheckOption[] {
  void g; void aircraftId; void start;
  return [];
}

/** Earliest check starts at a hub whose window holds ferry out + check + ferry home. Pure. */
export function cCheckSlots(g: GameState, aircraftId: string, hub: string, n?: number): Minute[] {
  void g; void aircraftId; void hub; void n;
  return [];
}

/** Books the C-check at a hub: ferry out, check, ferry home (all crewed by the auto-roster). */
export function bookCCheck(g: GameState, aircraftId: string, hub: string, start: Minute): ActionResult<{ maintId: string }> {
  void g; void aircraftId; void hub; void start;
  return { ok: false, error: 'v0.7.2 stub' };
}

/** A booked hub check's ferries and the pilots' airline tickets. Pure. */
export function checkLogistics(g: GameState, maintId: string): { ferryOut: Flight[]; ferryHome: Flight[]; tickets: CheckTicket[] } | null {
  void g; void maintId;
  return null;
}
