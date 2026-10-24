// v0.6 extra crew above the legal minimum (UPDATE-0.6.md §F4): per aircraft or contract, optional seats that
// never block a departure. The quote is pure; setCrewExtra re-seats the affected trips.

import { BAL } from '../core/balance';
import { flightsOf } from '../core/entities';
import { complement, isPilot, typeOf } from '../core/perf';
import { DAY } from '../core/time';
import type { ActionResult, CrewExtra, GameState } from '../core/types';
import { refreshPairing } from './duties';
import { crewExtraFor, paidMinOf } from './extraSeats';
import { salaryFor } from './generate';
import { setsForStation } from './sets';
import { autoRoster, releaseCrew, setFlightsCrew } from './roster';
import { crewIx, touchCrew } from './timeline';

/** Crew sets an aircraft is staffed for (staffing: 5, more on a deployment now or within 60 days). */
function setsOf(g: GameState, aircraftId: string): number {
  let onStation = 0;
  for (const dp of Object.values(g.deployments)) {
    if (dp.aircraftId !== aircraftId || dp.end < g.now || dp.start > g.now + 60 * DAY) continue;
    onStation = Math.max(onStation, dp.setsOnStation);
  }
  return setsForStation(onStation);
}

/** Nights the aircraft's crews spend away from base in 28 days: the last 28 days flown, else the next 28 planned. */
function awayNights(g: GameState, aircraftId: string): { nights: number; wet: boolean } {
  const home = g.company.homeBase;
  const fl = flightsOf(g, aircraftId).filter((f) => f.status !== 'cancelled' && f.aircraftId === aircraftId);
  const count = (from: number, to: number) => {
    const lastOfDay = new Map<number, string>();
    let wetN = 0;
    let n = 0;
    for (const f of fl) {
      if (f.sta < from || f.sta >= to) continue;
      lastOfDay.set(Math.floor(f.sta / DAY), f.to);
      n++;
      if (f.contractId && g.contracts[f.contractId]?.product.kind === 'wet') wetN++;
    }
    let nights = 0;
    for (const at of lastOfDay.values()) if (at !== home) nights++;
    return { nights, wet: n > 0 && wetN * 2 > n, n };
  };
  const past = count(g.now - 28 * DAY, g.now);
  return past.n ? past : count(g.now, g.now + 28 * DAY);
}

/** Cost and benefit estimate of an extra-crew setting on one aircraft: people to staff it, per month. Pure. */
export function crewExtraQuote(
  g: GameState, aircraftId: string, x: CrewExtra,
): { minimum: { pilots: number; cabin: number }; extraPeople: number; perMonth: number; morale: 'up' | 'none'; service: number } {
  const ac = g.fleet[aircraftId];
  const typeId = ac?.typeId ?? 'a320ceo';
  const roles = complement(typeId, ac?.cabin.total ?? 180);
  const minimum = { pilots: roles.filter(isPilot).length, cabin: roles.filter((r) => !isPilot(r)).length };
  const cabin = Math.max(0, Math.min(BAL.crewExtra.cabinMax, Math.round(x.cabin)));
  const pilot = x.pilot ? 1 : 0;
  if (!ac || cabin + pilot === 0) return { minimum, extraPeople: 0, perMonth: 0, morale: 'none', service: 0 };
  const sets = setsOf(g, aircraftId);
  const extraPeople = (cabin + pilot) * sets;
  const family = typeOf(typeId).family;
  const salaries = (cabin * salaryFor('CC', family) + pilot * salaryFor('FO', family)) * sets * (1 + BAL.onCosts);
  const away = awayNights(g, aircraftId);
  const k = 30.44 / 28;
  const pct = g.company.policies.perDiemPct / 100;
  const perDiem = away.nights * k * (cabin * BAL.perDiem.CC + pilot * BAL.perDiem.FO) * pct;
  const hotels = away.wet ? 0 : away.nights * k * (cabin + pilot) * (BAL.hotelPerNight[g.company.policies.hotelTier] ?? BAL.hotelPerNight[4]);
  const perMonth = Math.round((salaries + perDiem + hotels) / 100) * 100;
  const service = Math.min(BAL.morale.service.extraMax, BAL.morale.service.extraPer * cabin);
  return { minimum, extraPeople, perMonth, morale: 'up', service };
}

/**
 * Sets (x) or resets (null: back to the aircraft / company default) the extra crew of an aircraft or a contract.
 * A contract whose client pays for extra cabin crew can't go below the paid number. Trips not yet flown are
 * re-seated; with the auto-roster policy the new optional seats are filled now.
 */
export function setCrewExtra(g: GameState, target: { aircraftId: string } | { contractId: string }, x: CrewExtra | null): ActionResult {
  let v: CrewExtra | null = null;
  if (x) {
    if (!Number.isFinite(x.cabin) || x.cabin < 0 || x.cabin > BAL.crewExtra.cabinMax) return { ok: false, error: `Extra cabin crew: 0 to ${BAL.crewExtra.cabinMax}` };
    v = { cabin: Math.round(x.cabin), pilot: x.pilot ? 1 : 0 };
  }
  let acIds: string[];
  let contractId: string | null = null;
  let what: string;
  if ('aircraftId' in target) {
    const ac = g.fleet[target.aircraftId];
    if (!ac) return { ok: false, error: 'Aircraft not found' };
    if (v) ac.crewExtra = v;
    else delete ac.crewExtra;
    acIds = [ac.id];
    what = ac.reg;
  } else {
    const k = g.contracts[target.contractId];
    if (!k) return { ok: false, error: 'Contract not found' };
    if (k.status === 'completed' || k.status === 'cancelled') return { ok: false, error: 'This contract has ended' };
    const paid = paidMinOf(k);
    if (v && v.cabin < paid) return { ok: false, error: `The client pays for ${paid} extra cabin crew: at least ${paid}` };
    if (v) k.crewExtra = v;
    else delete k.crewExtra;
    acIds = [...k.aircraftIds];
    contractId = k.id;
    what = k.title;
  }
  // Re-seat the trips still to fly (crew on seats that went away are released).
  for (const id of acIds) {
    for (const p of [...(crewIx(g).byAircraft.get(id) ?? [])]) {
      if (!g.pairings[p.id] || (p.status !== 'planned' && p.status !== 'active')) continue;
      if (contractId && p.contractId !== contractId) continue;
      for (const crewId of refreshPairing(g, p)) releaseCrew(g, p, crewId);
      setFlightsCrew(g, p);
    }
  }
  touchCrew(g);
  if (g.company.policies.autoRoster) autoRoster(g, { aircraftIds: acIds.filter((id) => g.fleet[id]) });
  const eff = acIds[0] ? crewExtraFor(g, acIds[0], contractId) : null;
  const n = eff ? eff.cabin + eff.pilot : 0;
  return { ok: true, msg: n ? `${what}: ${eff!.cabin ? `+${eff!.cabin} cabin crew` : ''}${eff!.cabin && eff!.pilot ? ', ' : ''}${eff!.pilot ? 'spare pilot' : ''} above the minimum` : `${what}: legal minimum crew` };
}

