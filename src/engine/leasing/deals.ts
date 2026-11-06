// v0.17 from letter of intent to lease (UPDATE-0.17.md §F; lane `deals`). Step 0: no offer goes through a letter of
// intent (usesLoi false): every offer signs on the legacy path (ops/market.ts acquireAircraft → signOffer).

import type { ActionResult, AircraftOffer, GameState, LeaseDeal, Minute } from '../core/types';
import type { ForecastItem } from '../ops/finance';

export interface LoiOpts {
  autoSign?: boolean;
  lc?: boolean;
  paint?: boolean;
  techReps?: boolean;
  /** Registration and name chosen in the dialog (as acquireAircraft). */
  reg?: string;
  name?: string;
  delivery?: 'thisSide' | 'ferryCo';
}

/** The letter-of-intent dialog's rows (§N.3). */
export interface LoiQuote {
  offerId: string;
  holding: number;
  depositAtSign: number;
  transition: number;
  techReps: number;
  paint: number;
  /** 'Mid-life A320ceo $220K · 36 months +4 % · normal market −1 % · start-up rating +5 %'. */
  whyRent: string;
  /** '$560/FH · at least 80 FH a month · +3 % a year'. */
  reserves: string;
  /** 'Shannon · 7-day check · half-life 0.5'. */
  ret: string;
  /** Records · check · paint · acceptance, as dates. */
  ready: Minute;
  steps: { label: string; from: Minute; to: Minute }[];
  camo: string;
  aoc: string | null;
  pilots: string | null;
  lcAllowed: boolean;
  cashAfter: number;
  /** What stands in the way (null: can sign). */
  why: string | null;
}

/** Whether an offer goes through the letter of intent (§F). Step 0: none (legacy signing). Pure. */
export function usesLoi(g: GameState, o: AircraftOffer): boolean {
  void g;
  void o;
  return false;
}

/** Step 0: no quote (the dialog falls back on AcquireModal). Pure. */
export function loiQuote(g: GameState, offerId: string, opts: LoiOpts = {}): LoiQuote | null {
  void g;
  void offerId;
  void opts;
  return null;
}

/** Signs the letter of intent: the holding deposit, the offer kept as a snapshot in a LeaseDeal (§F step 1). Step 0: refused. */
export function signLoi(g: GameState, offerId: string, opts: LoiOpts = {}): ActionResult<{ dealId: string }> {
  void g;
  void offerId;
  void opts;
  return { ok: false, error: 'Letters of intent are not open yet' };
}

/** Signs the lease after approval (§F step 4). Step 0: no deals. */
export function signLease(g: GameState, dealId: string): ActionResult<{ aircraftId: string }> {
  void g;
  void dealId;
  return { ok: false, error: 'Deal not found' };
}

/** More security asked (§F 3b): pay it in cash or by letter of credit. Step 0: no deals. */
export function meetConditions(g: GameState, dealId: string, how: 'cash' | 'lc'): ActionResult {
  void g;
  void dealId;
  void how;
  return { ok: false, error: 'Deal not found' };
}

/** Walks away from a deal (the holding deposit back before approval, lost after). Step 0: no deals. */
export function walkAway(g: GameState, dealId: string): ActionResult {
  void g;
  void dealId;
  return { ok: false, error: 'Deal not found' };
}

/** Adds contract tech reps to a deal or a transition (§G.2). Step 0: no deals. */
export function addTechReps(g: GameState, id: string): ActionResult {
  void g;
  void id;
  return { ok: false, error: 'Deal not found' };
}

/** The In progress rows (§N.1): one per open deal (and transition). Step 0: none. Pure. */
export function dealsOpen(g: GameState): LeaseDeal[] {
  return (g.leasing?.deals ?? []).filter((d) => d.stage !== 'signed' && d.stage !== 'walked' && d.stage !== 'declined');
}

/** Daily: committee answers, signing windows lapsing (§F). Step 0: nothing. */
export function dailyDeals(g: GameState): void {
  void g;
}

/** The cash forecast's leasing lines (§K.3): holding deposits, deposits to sign, transition costs, first rents, short-term returns. Step 0: none. Pure. */
export function leasingForecastItems(g: GameState, days: number): ForecastItem[] {
  void g;
  void days;
  return [];
}
