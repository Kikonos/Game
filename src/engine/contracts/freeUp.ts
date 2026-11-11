// v0.20.1 report bmwbb036sdk6l (Guiana rotation via Pointe-à-Pitre; the player: "I subleased a trip from this aircraft
// at great cost to try to fit this contract in and even after that, it's not possible, the sublease options are
// misleading"). The offer dialog offered to sub-lease (or move) the trips in the way on every aircraft, and said
// "Solvable", without asking whether handing them over frees the aircraft: a base programme's days with no flights yet
// (Overflow: Edelweiss at Zurich on CS-TTD), another programme (a capacity lease on CS-TTL / CS-TPM) or an approval
// (ETOPS 180 on the A330s) kept blocking after the trips were gone. Here the job's feasibility is worked out again as if
// those trips were no longer ours, so the dialog proposes a hand-over only when it really makes room, and otherwise
// says plainly what still blocks. Pure.

import type { GameState } from '../core/types';
import { reasonText, topBlocker } from './blockers';
import { feasibility, type FeasibilityReport } from './feasibility';

export interface FreeUpVerdict {
  /** With those trips gone the job fits this aircraft (warnings aside). */
  fits: boolean;
  /** What still blocks, in plain words ('ETOPS 180 needed: we hold 120'), null when it fits. */
  still: string | null;
  /** The feasibility report with the trips gone. */
  report: FeasibilityReport;
}

/** The job's feasibility on an aircraft as if these legs were no longer ours (handed over or moved away). Pure. */
export function feasibilityWithout(g: GameState, offerId: string, aircraftId: string, flightIds: readonly string[], opts: Parameters<typeof feasibility>[3] = {}): FeasibilityReport {
  const flights = { ...g.flights };
  for (const id of flightIds) if (flights[id]) flights[id] = { ...flights[id], status: 'cancelled' };
  // A shallow copy: feasibility reads, never writes; its indexes are keyed by the state object, so the copy has its own.
  return feasibility({ ...g, flights }, offerId, aircraftId, opts);
}

/** Whether handing over (or moving) these legs makes the job fit the aircraft, and if not, what still blocks. Pure. */
export function freeUpVerdict(g: GameState, offerId: string, aircraftId: string, flightIds: readonly string[], opts: Parameters<typeof feasibility>[3] = {}): FreeUpVerdict {
  const report = feasibilityWithout(g, offerId, aircraftId, flightIds, opts);
  const top = topBlocker(report);
  if (!top) return { fits: true, still: null, report };
  return { fits: false, still: top.label.startsWith('Busy: ') ? `still busy with ${reasonText(g, top)}` : reasonText(g, top), report };
}

/** The sentence the dialog shows before a hand-over that won't make room on its own. */
export const freeUpWarning = (v: FreeUpVerdict, what = 'Sub-leasing these trips'): string => `${what} won't make room for this job on its own: ${v.still}.`;
