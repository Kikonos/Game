// v0.17 the aircraft market's problem cards (UPDATE-0.17.md §N.4; lane `deals`), four lines each: what · why · does it
// hurt · what you can do. Step 0: none (every card null, the list empty).

import type { GameState } from '../core/types';
import type { ProblemCard } from './types';

/** 'Avolon wants more security for the A330-200' (deal id). */
export function leaseConditionsCard(g: GameState, dealId: string): ProblemCard | null {
  void g;
  void dealId;
  return null;
}

/** 'Approved: sign the A320ceo lease' (deal id). */
export function leaseSignCard(g: GameState, dealId: string): ProblemCard | null {
  void g;
  void dealId;
  return null;
}

/** 'Records review found gaps on CS-TQB' (aircraft id). */
export function inductionDelayCard(g: GameState, aircraftId: string): ProblemCard | null {
  void g;
  void aircraftId;
  return null;
}

/** 'The 737-800 needs our AOC varied' (aircraft or deal id). */
export function variationNeededCard(g: GameState, id: string): ProblemCard | null {
  void g;
  void id;
  return null;
}

/** 'D-ATUB goes back to TUI fly on 31 Mar' (aircraft id). */
export function spotReturnCard(g: GameState, aircraftId: string): ProblemCard | null {
  void g;
  void aircraftId;
  return null;
}

/** Every current leasing problem (problems/index.ts problems). Step 0: none. Pure. */
export function leasingProblems(g: GameState): ProblemCard[] {
  void g;
  return [];
}
