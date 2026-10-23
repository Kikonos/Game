// v0.9 crew slip at a fuel stop (UPDATE-0.9.md §W): on a one-way sector with tech stops too long for one crew even with
// rest on board, a fresh crew flies to a stop by airline, rests and takes over. Pure reads.

import type { AcRest, GameState, Minute } from '../core/types';
import type { ChainShape, DutyNeed } from './duties';

export interface SlipPlan {
  /** The stop where the crews change (airport code) and the index of the first leg the fresh crew flies. */
  at: string;
  cutIndex: number;
  first: DutyNeed;
  second: DutyNeed;
  /** Crew per complement (the slip crew), one-way tickets ($) and hotel room nights. */
  crewN: number;
  tickets: number;
  hotelNights: number;
  text: string;
}

/** The best stop to change crews on a chain no single crew can fly (null: none, or the chain needs no slip). Pure. */
export function bestSlip(_g: GameState, _typeId: string, _rest: AcRest, _chain: ChainShape): SlipPlan | null {
  return null;
}

export interface SlipView {
  flightId: string;
  at: string;
  atName: string;
  inCrew: { names: string[]; ticketIds: string[]; arrives: Minute | null };
  outCrew: { names: string[]; ticketIds: string[]; leaves: Minute | null };
  text: string;
}

/** The crew change at the stop a flight starts or ends (null when none). Pure. */
export function slipOfFlight(_g: GameState, _flightId: string): SlipView | null {
  return null;
}

/** Crew changes on an aircraft's flights in [from, to). Pure. */
export function slipsOfAircraft(_g: GameState, _aircraftId: string, _from: Minute, _to: Minute): SlipView[] {
  return [];
}
