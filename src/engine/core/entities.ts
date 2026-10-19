// Ids, entity creation helpers shared by all modules, and runtime indexes (not saved).

import { schedule } from './queue';
import type { Flight, FlightKind, GameState, Minute } from './types';

export function nextId(g: GameState, prefix: string): string {
  return `${prefix}${(++g.seq).toString(36)}`;
}

// ---------- runtime indexes ----------

interface Index {
  flightsRev: number;
  builtRev: number;
  byAircraft: Map<string, Flight[]>;
}

const indexes = new WeakMap<GameState, Index>();

function index(g: GameState): Index {
  let ix = indexes.get(g);
  if (!ix) {
    ix = { flightsRev: 1, builtRev: 0, byAircraft: new Map() };
    indexes.set(g, ix);
  }
  return ix;
}

/** Call after adding, removing or re-timing flights outside the helpers below. */
export function touchFlights(g: GameState): void {
  index(g).flightsRev++;
}

/** Revision counter the UI can use as a memo key for schedule views. */
export function flightsRev(g: GameState): number {
  return index(g).flightsRev;
}

/** An aircraft's flights sorted by scheduled departure (cancelled ones included; filter as needed). */
export function flightsOf(g: GameState, aircraftId: string): Flight[] {
  const ix = index(g);
  if (ix.builtRev !== ix.flightsRev) {
    ix.byAircraft.clear();
    for (const f of Object.values(g.flights)) {
      if (!f.aircraftId) continue;
      let list = ix.byAircraft.get(f.aircraftId);
      if (!list) ix.byAircraft.set(f.aircraftId, (list = []));
      list.push(f);
    }
    for (const list of ix.byAircraft.values()) list.sort((a, b) => a.std - b.std || (a.id < b.id ? -1 : 1));
    ix.builtRev = ix.flightsRev;
  }
  return ix.byAircraft.get(aircraftId) ?? [];
}

// ---------- flights ----------

export interface FlightInit {
  no: string;
  aircraftId: string | null;
  contractId: string | null;
  kind: FlightKind;
  from: string;
  to: string;
  std: Minute;
  sta: Minute;
  pax?: number;
  cost?: number;
}

/** Creates a scheduled flight and queues its departure (aircraft flights only; deadheads are moved by crew logic). */
export function addFlight(g: GameState, init: FlightInit): Flight {
  const f: Flight = {
    id: nextId(g, 'f'),
    ...init,
    block: init.sta - init.std,
    crewIds: [],
    dutyId: null,
    status: 'scheduled',
    delay: 0,
    ev: 0,
  };
  g.flights[f.id] = f;
  if (f.aircraftId) schedule(g, f.std, 'flight.dep', f.id, f.ev);
  touchFlights(g);
  return f;
}

/** Moves a scheduled flight (delay or re-plan) and re-queues its departure. */
export function retimeFlight(g: GameState, f: Flight, std: Minute, sta: Minute): void {
  f.std = std;
  f.sta = sta;
  f.block = sta - std;
  f.ev++;
  if (f.aircraftId && f.status === 'scheduled') schedule(g, std, 'flight.dep', f.id, f.ev);
  touchFlights(g);
}

export function cancelFlight(g: GameState, f: Flight, reason?: string): void {
  f.status = 'cancelled';
  f.delayReason = reason ?? f.delayReason;
  f.ev++;
  touchFlights(g);
}

/** Deletes flights (e.g. un-generating a cancelled contract's future legs). */
export function removeFlights(g: GameState, ids: string[]): void {
  for (const id of ids) delete g.flights[id];
  touchFlights(g);
}

/** Next own flight number, e.g. 'ATW 1203'. */
export function ownFlightNo(g: GameState): string {
  return `${g.company.icao}${g.company.nextFlightNo++}`;
}
