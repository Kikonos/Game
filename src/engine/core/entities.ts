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
  /** Aircraft whose flights changed since the last settle → earliest affected minute (crew re-syncs them). */
  changed: Map<string, Minute>;
}

const indexes = new WeakMap<GameState, Index>();

function index(g: GameState): Index {
  let ix = indexes.get(g);
  if (!ix) {
    ix = { flightsRev: 1, builtRev: 0, byAircraft: new Map(), changed: new Map() };
    indexes.set(g, ix);
  }
  return ix;
}

/** Call after adding, removing or re-timing flights outside the helpers below. */
export function touchFlights(g: GameState): void {
  index(g).flightsRev++;
}

/** Records that an aircraft's flights from t on changed (retime, cancel, removal, reassignment). */
export function markFlightsChanged(g: GameState, aircraftId: string | null, t: Minute): void {
  if (!aircraftId) return;
  const ch = index(g).changed;
  const prev = ch.get(aircraftId);
  if (prev === undefined || t < prev) ch.set(aircraftId, t);
}

/** Takes and clears the change marks (crew's settle hook: onFlightsChanged per aircraft). */
export function takeFlightChanges(g: GameState): Map<string, Minute> {
  const ix = index(g);
  const out = ix.changed;
  ix.changed = new Map();
  return out;
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

/** Creates a scheduled flight on an aircraft and queues its departure. Crew tickets use addDeadhead. */
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

/**
 * A commercial ticket for a group of crew (one Flight per group, aircraftId null). Queues only 'flight.arr':
 * ops marks it done, crew moves the group. The ticket cost is posted by crew at purchase (DESIGN.md §5.3).
 */
export function addDeadhead(g: GameState, d: { crewIds: string[]; from: string; to: string; std: Minute; sta: Minute; cost: number; contractId?: string | null }): Flight {
  const f: Flight = {
    id: nextId(g, 'f'), no: 'DH', aircraftId: null, contractId: d.contractId ?? null, kind: 'deadhead', from: d.from, to: d.to,
    std: d.std, sta: d.sta, block: d.sta - d.std, crewIds: [...d.crewIds], dutyId: null, status: 'scheduled', delay: 0, ev: 0, cost: d.cost,
  };
  g.flights[f.id] = f;
  schedule(g, f.sta, 'flight.arr', f.id, f.ev);
  touchFlights(g);
  return f;
}

/** Moves a scheduled flight (delay or re-plan) and re-queues its departure. */
export function retimeFlight(g: GameState, f: Flight, std: Minute, sta: Minute): void {
  markFlightsChanged(g, f.aircraftId, Math.min(f.std, std));
  f.std = std;
  f.sta = sta;
  f.block = sta - std;
  f.ev++;
  if (f.aircraftId && f.status === 'scheduled') schedule(g, std, 'flight.dep', f.id, f.ev);
  // A sub-chartered leg or a crew ticket (no aircraft of ours) completes at its new arrival.
  else if ((f.operatedBy || f.kind === 'deadhead') && f.status === 'scheduled') schedule(g, sta, 'flight.arr', f.id, f.ev);
  touchFlights(g);
}

export function cancelFlight(g: GameState, f: Flight, reason?: string): void {
  markFlightsChanged(g, f.aircraftId, f.std);
  f.status = 'cancelled';
  f.delayReason = reason ?? f.delayReason;
  f.ev++;
  touchFlights(g);
}

/** Deletes flights (e.g. un-generating a cancelled contract's future legs). */
export function removeFlights(g: GameState, ids: string[]): void {
  for (const id of ids) {
    const f = g.flights[id];
    if (f) markFlightsChanged(g, f.aircraftId, f.std);
    delete g.flights[id];
  }
  touchFlights(g);
}

/** Moves scheduled flights to another aircraft (AOG swap): re-queues departures; both aircraft re-sync crew. */
export function reassignFlights(g: GameState, ids: string[], aircraftId: string): void {
  for (const id of ids) {
    const f = g.flights[id];
    if (!f || f.status !== 'scheduled' || f.aircraftId === aircraftId) continue;
    markFlightsChanged(g, f.aircraftId, f.std);
    markFlightsChanged(g, aircraftId, f.std);
    f.aircraftId = aircraftId;
    f.ev++;
    schedule(g, f.std, 'flight.dep', f.id, f.ev);
  }
  touchFlights(g);
}

/**
 * Hands scheduled legs to a rival (sub-charter, DESIGN.md §5.8): the leg leaves our aircraft, keeps its contract
 * (billing counts it on 'flight.arr'), and only 'flight.arr' is queued. The cost is posted by the caller.
 */
export function subcharterFlights(g: GameState, ids: string[], rivalId: string): void {
  for (const id of ids) {
    const f = g.flights[id];
    if (!f || f.status !== 'scheduled' || !f.aircraftId) continue;
    markFlightsChanged(g, f.aircraftId, f.std);
    f.aircraftId = null;
    f.operatedBy = rivalId;
    f.crewIds = [];
    f.dutyId = null;
    f.ev++;
    schedule(g, f.sta, 'flight.arr', f.id, f.ev);
  }
  touchFlights(g);
}

/** Next own flight number, e.g. 'ATW 1203'. */
export function ownFlightNo(g: GameState): string {
  return `${g.company.icao}${g.company.nextFlightNo++}`;
}
