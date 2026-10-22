// Developer helpers (console: __contrail.dev). Lets the map and screens be built before the
// contract generator exists: demo flights on the fleet. Not used by the game itself.

import { ACMI_TYPES } from '../data/acmiTypes';
import { addFlight, ownFlightNo, removeFlights, touchFlights } from './core/entities';
import { DAY } from './core/time';
import { cabinFrom } from './newGame';
import { makeCrewMember } from './crew/generate';
import { rerosterFrom } from './crew';
import { touchCrew, touchCrewState } from './crew/timeline';
import { blockMinutes } from './core/perf';
import { flightsOf } from './core/entities';
import { nextId } from './core/entities';
import type { AcRest, Aircraft, GameState, Role } from './core/types';
import { typeOf } from './core/perf';
import { offsetAt } from './crew/rules';
import { escalateShortages } from './crew/control';
import { recheckPairing, releaseCrew, setFlightsCrew } from './crew/roster';
import { bunksFor, fittedRest, migrateRest } from './crew/restPlan';

/** Out-and-back legs from each aircraft's position, starting in 30 min, for `days` days (ferries by default: no client). */
export function demoFlights(g: GameState, dests = ['FAO', 'FNC', 'PMI', 'TFS', 'OPO', 'AGP'], days = 3, kind: 'ferry' | 'revenue' = 'ferry'): number {
  let n = 0;
  Object.values(g.fleet).forEach((ac, i) => {
    const last = flightsOf(g, ac.id).at(-1);
    let t = Math.max(g.now + 30, last ? last.sta + 60 : 0);
    let at = last ? last.to : ac.at;
    const home = at;
    for (let d = 0; d < days * 2; d++) {
      const to = d % 2 === 0 ? dests[(i + d) % dests.length] : home;
      const block = blockMinutes(ac.typeId, at, to);
      addFlight(g, { no: ownFlightNo(g), aircraftId: ac.id, contractId: null, kind, from: at, to, std: t, sta: t + block });
      t += block + 50 + (d % 2 === 1 ? 6 * 60 : 0);
      at = to;
      n++;
    }
  });
  return n;
}

/** Stress fleet for map/screen perf work: clones of the first aircraft at home base (n total). */
export function devFleet(g: GameState, n = 10): number {
  const base = Object.values(g.fleet)[0];
  if (!base) return 0;
  let added = 0;
  for (let k = Object.keys(g.fleet).length; k < n; k++, added++) {
    const id = nextId(g, 'a');
    const reg = `${g.company.regPrefix}DV${String.fromCharCode(65 + (k % 26))}`;
    g.fleet[id] = { ...structuredClone(base), id, reg, at: g.company.homeBase, flightId: null, status: 'available', maintId: null };
  }
  return added;
}

/** v0.6: crew member resigns now (notice period from BAL.morale.noticeDays). Dev/test helper. */
export { resignNow } from './crew/morale';

/** v0.7: posts a market offer now (type, kind, new-build, handover site); returns its id. Dev/test helper. */
export { devMarketOffer } from './ops/market';
/** v0.7: grants an approval now (as if the authority finished). Dev/test helper. */
export { devGrantApproval } from './ops/company';

/**
 * v0.7.1: empties the required seats (`roles`, default the pilots) of the next crewed flight departing within
 * `hours` (default 10) and runs the ladder, so Crew Control has something to show; returns the flight id ('' when
 * nothing qualifies). Dev/test helper.
 */
export function devCrewShortage(g: GameState, opts: { hours?: number; roles?: Role[] } = {}): string {
  const hours = opts.hours ?? 10;
  const roles = opts.roles ?? ['CPT', 'FO'];
  const cands = Object.values(g.flights)
    .filter((f) => f.status === 'scheduled' && f.aircraftId && f.kind !== 'deadhead' && f.dutyId && f.std > g.now && f.std <= g.now + hours * 60 && f.crewIds.length > 0)
    .sort((a, b) => a.std - b.std || (a.id < b.id ? -1 : 1));
  for (const f of cands) {
    const d = g.duties[f.dutyId!];
    const p = d ? g.pairings[d.pairingId] : undefined;
    if (!p || d.flightIds[0] !== f.id || d.report <= g.now) continue;
    for (const s of p.slots) if (s.crewId && roles.includes(s.role)) releaseCrew(g, p, s.crewId);
    setFlightsCrew(g, p);
    recheckPairing(g, p);
    escalateShortages(g);
    return f.id;
  }
  return '';
}

/**
 * v0.7.2: a widebody (an A330-300 clone at home base) without bunks, crew rest seats fitted, its crew hired and an
 * augmented LIS–GRU duty booked two days out with a full load; returns the long flight's id. Dev/test helper.
 */
export function devRestSeats(g: GameState): string {
  const base = Object.values(g.fleet)[0];
  if (!base) return '';
  const home = g.company.homeBase;
  for (const a of ['widebody', 'augmented'] as const) if (!g.company.approvals.includes(a)) g.company.approvals.push(a);
  const t = ACMI_TYPES.a333;
  const id = nextId(g, 'a');
  const ac = { ...structuredClone(base), id, reg: `${g.company.regPrefix}DVR`, typeId: t.id, cabin: cabinFrom(t.cabins[t.cabins.length - 1]), at: home, flightId: null, status: 'available' as const, maintId: null, crewRest: { bunks: false, seats: t.yAbreast }, rest: undefined as AcRest | undefined, bhDays: [] };
  ac.rest = migrateRest(ac);
  ac.maint = { ...ac.maint, fhSinceA: 0, lastA: g.now, fhSinceC: 0, lastC: g.now };
  g.fleet[id] = ac;
  for (const [role, n] of [['CPT', 3], ['FO', 4], ['PUR', 3], ['CC', 24]] as const) for (let i = 0; i < n; i++) {
    const c = makeCrewMember(g, role, t.family, home);
    g.crew[c.id] = c;
  }
  const dest = home === 'GRU' ? 'LIS' : 'GRU';
  const std = Math.ceil((g.now + 2 * DAY) / 60) * 60;
  const blk = Math.max(12 * 60 + 30, blockMinutes(t.id, home, dest));
  const f = addFlight(g, { no: ownFlightNo(g), aircraftId: id, contractId: null, kind: 'revenue', from: home, to: dest, std, sta: std + blk, pax: ac.cabin.total });
  addFlight(g, { no: ownFlightNo(g), aircraftId: id, contractId: null, kind: 'revenue', from: dest, to: home, std: std + blk + DAY, sta: std + 2 * blk + DAY, pax: ac.cabin.total - 20 });
  touchCrew(g);
  rerosterFrom(g, id, g.now);
  return f.id;
}

/** v0.7.2: an owned aircraft with no work after 10 days (its later legs removed): ready to sell; returns its id ('' when none). Dev/test helper. */
export function devSaleReady(g: GameState): string {
  const ac = Object.values(g.fleet).find((a) => a.ownership.kind === 'owned' && !a.sale && a.status !== 'delivering');
  if (!ac) return '';
  const later = flightsOf(g, ac.id).filter((f) => f.status === 'scheduled' && f.std > g.now + 10 * DAY);
  if (later.length) removeFlights(g, later.map((f) => f.id));
  for (const c of Object.values(g.contracts)) if ((c.status === 'signed' || c.status === 'active') && c.pattern.kind === 'base' && c.aircraftIds.includes(ac.id) && c.pattern.to > g.now + 10 * DAY) c.aircraftIds = c.aircraftIds.filter((x) => x !== ac.id);
  for (const m of Object.values(g.maintenance)) if (m.aircraftId === ac.id && m.status === 'planned' && m.end > g.now + 10 * DAY) m.status = 'cancelled';
  touchFlights(g);
  return ac.id;
}

// ---------- v0.7.3 (UPDATE-0.7.3.md §7): each returns the id to open ----------

/** v0.7.4: an aircraft of `typeId` at home base (nothing fitted unless the type always has bunks) with a crew for it; returns its id. Dev/test helper. */
export function devAddType(g: GameState, typeId: string, cabinIx = 0): string {
  const t = ACMI_TYPES[typeId];
  if (!t) return '';
  const ac = devWide(g, typeId, t.rest.bunkShare >= 1 ? bunksFor(typeId) : { fc: null, cc: null }, `D${typeId.slice(-2).toUpperCase()}`, cabinIx);
  return ac?.id ?? '';
}

/** A widebody clone of the first aircraft at home base with these facilities and its crew hired (dev). */
function devWide(g: GameState, typeId: string, rest: AcRest, suffix: string, cabinIx = 0): Aircraft | null {
  const base = Object.values(g.fleet)[0];
  if (!base) return null;
  const home = g.company.homeBase;
  for (const a of ['widebody', 'augmented'] as const) if (!g.company.approvals.includes(a)) g.company.approvals.push(a);
  const t = ACMI_TYPES[typeId];
  const id = nextId(g, 'a');
  // v0.7.4 fitted facilities only (the cabin's curtained seats are always there), bunks paired.
  const ac: Aircraft = { ...structuredClone(base), id, reg: `${g.company.regPrefix}${suffix}`, typeId, cabin: cabinFrom(t.cabins[cabinIx]), at: home, flightId: null, status: 'available', maintId: null, rest: fittedRest(typeId, structuredClone(rest)), restV: 2, bhDays: [] };
  delete ac.crewRest;
  ac.maint = { ...ac.maint, fhSinceA: 0, lastA: g.now, fhSinceC: 0, lastC: g.now };
  g.fleet[id] = ac;
  for (const [role, n] of [['CPT', 4], ['FO', 5], ['PUR', 3], ['CC', 24]] as const) for (let i = 0; i < n; i++) {
    const c = makeCrewMember(g, role, t.family, home);
    g.crew[c.id] = c;
  }
  return ac;
}

/** An A330-200 with business seats (class 2) for both sides and an augmented LIS–GRU duty two days out; the long flight's id. */
export function devRestPlan(g: GameState): string {
  const ac = devWide(g, 'a332', { fc: { cls: 2, kind: 'jSeats', places: 2 }, cc: { cls: 2, kind: 'jSeats', places: 5 } }, 'DVJ');
  if (!ac) return '';
  const home = g.company.homeBase;
  const dest = home === 'GRU' ? 'LIS' : 'GRU';
  const std = Math.ceil((g.now + 2 * DAY) / 60) * 60;
  const blk = Math.max(11 * 60 + 40, blockMinutes(ac.typeId, home, dest));
  const f = addFlight(g, { no: ownFlightNo(g), aircraftId: ac.id, contractId: null, kind: 'revenue', from: home, to: dest, std, sta: std + blk, pax: ac.cabin.total - 10 });
  addFlight(g, { no: ownFlightNo(g), aircraftId: ac.id, contractId: null, kind: 'revenue', from: dest, to: home, std: std + blk + DAY, sta: std + 2 * blk + DAY, pax: ac.cabin.total - 30 });
  touchCrew(g);
  rerosterFrom(g, ac.id, g.now);
  return f.id;
}

/** A 3-sector day of 3:40 legs on an A330 with bunks (a 14:50 day): the cruise is too short for in-flight rest; the first flight's id. */
export function devShortCruise(g: GameState): string {
  const ac = devWide(g, 'a332', { fc: { cls: 1, kind: 'fcrc', places: 2 }, cc: { cls: 1, kind: 'ldmcr', places: 7 } }, 'DVK');
  if (!ac) return '';
  const home = g.company.homeBase;
  const route = home === 'REC' ? [home, 'FNC', 'SID', 'FNC'] : [home, 'SID', 'REC', 'SID'];
  let t = Math.ceil((g.now + 2 * DAY) / 60) * 60 + 7 * 60;
  let first = '';
  for (let i = 0; i < 3; i++) {
    const f = addFlight(g, { no: ownFlightNo(g), aircraftId: ac.id, contractId: null, kind: 'revenue', from: route[i], to: route[i + 1], std: t, sta: t + 220, pax: 200 });
    first ||= f.id;
    t += 220 + 70;
  }
  addFlight(g, { no: ownFlightNo(g), aircraftId: ac.id, contractId: null, kind: 'ferry', from: route[3], to: home, std: t + DAY, sta: t + DAY + 240 });
  touchCrew(g);
  rerosterFrom(g, ac.id, g.now);
  return first;
}

/** An A320 13:40 out-and-back from home base (08:00 report) planned as an extension; the duty id. */
export function devExtension(g: GameState): string {
  const ac = Object.values(g.fleet).find((a) => typeOf(a.typeId).body === 'narrow');
  if (!ac) return '';
  const home = g.company.homeBase;
  const dest = home === 'TLV' ? 'LIS' : 'TLV';
  const day = Math.ceil((g.now + 3 * DAY) / DAY) * DAY;
  const std = day + 9 * 60 - offsetAt(home, day) ;
  const f = addFlight(g, { no: ownFlightNo(g), aircraftId: ac.id, contractId: null, kind: 'revenue', from: home, to: dest, std, sta: std + 350, pax: 150 });
  addFlight(g, { no: ownFlightNo(g), aircraftId: ac.id, contractId: null, kind: 'revenue', from: dest, to: home, std: std + 410, sta: std + 760, pax: 150 });
  touchCrew(g);
  rerosterFrom(g, ac.id, g.now);
  return g.flights[f.id].dutyId ?? '';
}

/** An A320 night out-and-back to FNC with a 4:30 wait (a split duty in a hotel day room); the duty id. */
export function devSplit(g: GameState): string {
  const ac = Object.values(g.fleet).find((a) => typeOf(a.typeId).body === 'narrow');
  if (!ac) return '';
  const home = g.company.homeBase;
  const dest = home === 'FNC' ? 'LIS' : 'FNC';
  const day = Math.ceil((g.now + 3 * DAY) / DAY) * DAY;
  const std = day + 23 * 60 - offsetAt(home, day);
  const f = addFlight(g, { no: ownFlightNo(g), aircraftId: ac.id, contractId: null, kind: 'revenue', from: home, to: dest, std, sta: std + 180, pax: 150 });
  addFlight(g, { no: ownFlightNo(g), aircraftId: ac.id, contractId: null, kind: 'revenue', from: dest, to: home, std: std + 180 + 270, sta: std + 180 + 270 + 180, pax: 150 });
  touchCrew(g);
  rerosterFrom(g, ac.id, g.now);
  return g.flights[f.id].dutyId ?? '';
}

/** The next crewed flight from base within 10 h loses its captain; a free captain at base is on home standby now; the flight id. */
export function devStandby(g: GameState): string {
  // A crewed out-and-back from base in 4 h on the first aircraft (a new game has nothing that soon).
  const ac0 = Object.values(g.fleet).find((a) => a.status === 'available' && a.at === g.company.homeBase);
  if (ac0) {
    const std = Math.ceil((g.now + 4 * 60) / 60) * 60;
    const dest = g.company.homeBase === 'FAO' ? 'LIS' : 'FAO';
    const blk = blockMinutes(ac0.typeId, g.company.homeBase, dest);
    addFlight(g, { no: ownFlightNo(g), aircraftId: ac0.id, contractId: null, kind: 'revenue', from: g.company.homeBase, to: dest, std, sta: std + blk, pax: 150 });
    addFlight(g, { no: ownFlightNo(g), aircraftId: ac0.id, contractId: null, kind: 'revenue', from: dest, to: g.company.homeBase, std: std + blk + 50, sta: std + 2 * blk + 50, pax: 150 });
    touchCrew(g);
    rerosterFrom(g, ac0.id, g.now);
  }
  const fid = devCrewShortage(g, { roles: ['CPT'] });
  const f = fid ? g.flights[fid] : undefined;
  const ac = f?.aircraftId ? g.fleet[f.aircraftId] : undefined;
  if (!f || !ac) return fid;
  const fam = typeOf(ac.typeId).family;
  const home = g.company.homeBase;
  const crewOn = new Set(Object.values(g.pairings).flatMap((p) => p.slots.map((s) => s.crewId)));
  const c = Object.values(g.crew).find((x) => x.role === 'CPT' && x.ratings.includes(fam) && x.base === home && x.loc === home && !crewOn.has(x.id) && x.restUntil <= g.now && !x.blocks?.length);
  if (c) {
    const from = g.now - 60;
    (c.standby ??= []).push({ from, to: from + 12 * 60 });
    touchCrewState(g);
  }
  return fid;
}
