// B2 — Crew & HR. Public API for the UI and other modules.

import type { SimModule } from '../core/module';
import type { GameState, SimEvent } from '../core/types';
import { dailyCrewCosts, monthlySalaries } from './costs';
import { onCrewJoin, onTrainingDone } from './hr';
import { takeFlightChanges } from '../core/entities';
import { autoRoster, onFlightsChanged } from './roster';

export { crewWindows, checkAssignment, dutyLegality, LIMITS, maxFdp, minRest, type CrewWindows, type FdpInput, type IssueCode, type LegalityIssue, type LegalityReport, type RestInput } from './ftl';
export { crewName, makeCrewMember, salaryFor } from './generate';
export { crewAvailability, hireCrew, hireQuote, staffing, trainCrew, type Availability, type HireRequest, type RoleCapacity, type StaffingLine } from './hr';
export { applyDiscretion, assignCrew, autoRoster, buildDuties, flightCrewStatus, onFlightsChanged, removeCrew, replaceCrew, rerosterFrom, rosterOf, unassignCrew, type FlightCrewStatus, type RosterResult } from './roster';

/** 'duty.report' / 'duty.release': crew status, logs, rest-until, location. TODO(B2) */
function onDutyReport(_g: GameState, _ev: SimEvent): void {}
function onDutyRelease(_g: GameState, _ev: SimEvent): void {}
/** 'flight.arr': move crew on board (and deadheaders) to the arrival airport. TODO(B2) */
function onFlightArrCrew(_g: GameState, _ev: SimEvent): void {}

function daily(g: GameState) {
  dailyCrewCosts(g);
  // Keep the published roster horizon filled (auto-roster policy).
  if (g.company.policies.autoRoster) autoRoster(g);
}

export const crewModule: SimModule = {
  name: 'crew',
  // TODO(B2): load(g) rebuilds the crew → duties index; default new fields with ??= (SAVE_VERSION stays 1 until release).
  settle(g) {
    for (const [aircraftId, t] of takeFlightChanges(g)) onFlightsChanged(g, aircraftId, t);
  },
  handlers: {
    day: daily,
    month: monthlySalaries,
    'duty.report': onDutyReport,
    'duty.release': onDutyRelease,
    'flight.arr': onFlightArrCrew,
    'crew.join': onCrewJoin,
    'training.done': onTrainingDone,
  },
};
