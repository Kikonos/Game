// v0.7 lease returns: 120-day notice, extend or return, return ferry + check + costs (UPDATE-0.7.md §F6.6). STUB.

import type { ActionResult, Aircraft, GameState, Minute } from '../core/types';
import type { DeliveryLeg } from './delivery';

export interface ReturnQuote { site: string; lines: { label: string; amount: number }[]; total: number; deposit: number; checkDays: number; ferry: DeliveryLeg[] }
export type LeaseChoice = 'extend12' | 'extend36' | 'return';
export interface LeaseView {
  lessor: string; ends: Minute; daysLeft: number; rent: number; returnSite: string;
  options: { id: LeaseChoice; label: string; rent?: number; cost?: number; chips: string[] }[];
  returning: Aircraft['returning'] | null; decisionId: string | null;
}

export function returnQuote(_g: GameState, _aircraftId: string): ReturnQuote | null {
  return null;
}

export function leaseView(_g: GameState, _aircraftId: string): LeaseView | null {
  return null;
}

export function chooseLease(_g: GameState, _aircraftId: string, _choice: LeaseChoice): ActionResult {
  return { ok: false, error: 'v0.7 stub' };
}
