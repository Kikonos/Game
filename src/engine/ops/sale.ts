// v0.7.2 selling owned aircraft and the least-used ranking (UPDATE-0.7.2.md §6.1, §6.3).

import type { ActionResult, GameState, Minute } from '../core/types';

export interface SaleQuote {
  ok: boolean;
  why: string | null;
  price: number;
  /** 'Market value 2009 A320' … '−C-check life used' … 'Broker 2%'. */
  lines: { label: string; amount: number }[];
  buyer: string;
  closes: Minute;
  bookValue: number;
  gain: number;
  /** 'TUI summer programme: 12 legs after 14 Nov'. */
  blockers: string[];
}

/** What a buyer pays for an owned aircraft now (pure: buyer and days from hashUnit(id + day)). */
export function saleQuote(g: GameState, aircraftId: string): SaleQuote {
  void aircraftId;
  return { ok: false, why: 'v0.7.2 stub', price: 0, lines: [], buyer: '', closes: g.now, bookValue: 0, gain: 0, blockers: [] };
}

/** Agrees the sale at the quoted price; it closes on `closes` (a ferry home is booked when it would be elsewhere). */
export function sellAircraft(g: GameState, aircraftId: string, expectPrice?: number): ActionResult<{ closes: Minute }> {
  void g; void aircraftId; void expectPrice;
  return { ok: false, error: 'v0.7.2 stub' };
}

/** Calls off an agreed sale before it closes (free: the buyer walks away). */
export function cancelSale(g: GameState, aircraftId: string): ActionResult {
  void g; void aircraftId;
  return { ok: false, error: 'v0.7.2 stub' };
}

export interface LeastUsedRow { aircraftId: string; bh90: number; perDay: number; days: number }

/** Aircraft by utilisation over the last 90 days (block hours from bhDays), lowest first. Pure. */
export function leastUsed(g: GameState, kind: 'owned' | 'leased' | 'any'): LeastUsedRow[] {
  void g; void kind;
  return [];
}
