// Developer helpers (console: __contrail.dev). Lets the map and screens be built before the
// contract generator exists: demo flights on the fleet. Not used by the game itself.

import { airframeVariant } from '../data/variants';
import { grantAchievement } from './ops/achievements';
import { dailyHeads, hireHead, unlockHead } from './ops/heads';
import { acceptOffer } from './contracts/accept';
import { ACMI_TYPES } from '../data/acmiTypes';
import { addFlight, ownFlightNo, removeFlights, touchFlights } from './core/entities';
import { DAY } from './core/time';
import { cabinFrom } from './newGame';
import { makeCrewMember } from './crew/generate';
import { rerosterFrom } from './crew';
import { touchCrew, touchCrewState } from './crew/timeline';
import { payLeaver } from './crew/costs';
import { blockMinutes } from './core/perf';
import { flightsOf } from './core/entities';
import { nextId } from './core/entities';
import type { AcRest, Aircraft, ClientLevel, GameState, HeadId, OohLimit, Role } from './core/types';
import { finalizeDraft, forceJumbo, generateOffer, type Draft } from './contracts/offers';
import { rivalFits } from './contracts/rivals';
import { schedule } from './core/queue';
import { typeOf } from './core/perf';
import { offsetAt } from './crew/rules';
import { escalateShortages } from './crew/control';
import { recheckPairing, releaseCrew, setFlightsCrew } from './crew/roster';
import { fittedRest, migrateRest, rollRestFor } from './crew/restPlan';
import { usedHoursCycles, usedMarketValue } from './ops/sale';
import { yearOf } from './core/time';
import { seasonBase } from './crew/fixtures';
import { advanceTo, settle } from './sim';
import { restPlan } from './crew';
import { delayFlight } from './ops/flights';
import { monthPlan, peakForecast, type PeakGap } from './crew/forecast';
import { removeCrew } from './crew/roster';
import { monthKey } from './core/time';

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
    // The scene shows the red shortage itself: no routine call-out first.
    escalateShortages(g, { freeFix: false });
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
  for (const a of ['widebody', 'augmented'] as const) if (!g.company.approvals.includes(a)) { g.company.approvals.push(a); (g.company.approvalsAt ??= {})[a] = g.now; }
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

/** v0.7.4: an aircraft of `typeId` at home base (its own airframe and rest roll, v0.8 pre-release) with a crew for it; returns its id. Dev/test helper. */
export function devAddType(g: GameState, typeId: string, cabinIx = 0): string {
  const t = ACMI_TYPES[typeId];
  if (!t) return '';
  // v0.8 pre-release: the type's own rest roll (as the market's, per airframe), not bunks only on bunkShare 1 types.
  const ac = devWide(g, typeId, null, `D${typeId.slice(-2).toUpperCase()}`, cabinIx);
  return ac?.id ?? '';
}

/**
 * v0.8 pre-release: a dev airframe of the type (not the cloned A320's 2006 frame, 52,000 h / 30,800 cycles and $9.5M
 * book): a mid-life frame (12 years old, within the type's production years), the sale model's hours and the type's own
 * cycles (a 747-400 about one per 8.5 h), owned at its market value; widebodies ETOPS as delivered from the market.
 */
export function devAirframe(g: GameState, typeId: string): Pick<Aircraft, 'builtYear' | 'hours' | 'cycles' | 'ownership' | 'etops'> {
  const t = ACMI_TYPES[typeId];
  const now = yearOf(g.now);
  const builtYear = Math.min(t.lastYear ?? now - 1, now - 1, Math.max(t.firstYear ?? 0, now - 12));
  const { hours, cycles } = usedHoursCycles(typeId, now - builtYear);
  const bookValue = Math.round(usedMarketValue(g, typeId, builtYear) / 10_000) * 10_000;
  return { builtYear, hours, cycles, ownership: { kind: 'owned', bookValue }, etops: t.body === 'wide' ? Math.min(180, t.etopsMax) : 0 };
}

/**
 * A widebody of the first aircraft's state at home base with these facilities (null: the type's market roll) and its
 * crew hired (dev); v0.8 pre-release: its own airframe (devAirframe), not the A320's hours, cycles and value.
 */
function devWide(g: GameState, typeId: string, rest: AcRest | null, suffix: string, cabinIx = 0): Aircraft | null {
  const base = Object.values(g.fleet)[0];
  if (!base) return null;
  const home = g.company.homeBase;
  for (const a of ['widebody', 'augmented'] as const) if (!g.company.approvals.includes(a)) { g.company.approvals.push(a); (g.company.approvalsAt ??= {})[a] = g.now; }
  const t = ACMI_TYPES[typeId];
  const id = nextId(g, 'a');
  const cabin = cabinFrom(t.cabins[cabinIx]);
  const facilities = rest ?? rollRestFor(id, typeId, cabin.j);
  // v0.7.4 fitted facilities only (the cabin's curtained seats are always there), bunks paired.
  const ac: Aircraft = { ...structuredClone(base), ...devAirframe(g, typeId), id, reg: `${g.company.regPrefix}${suffix}`, typeId, cabin, at: home, flightId: null, status: 'available', maintId: null, rest: fittedRest(typeId, structuredClone(facilities)), restV: 2, bhDays: [] };
  delete ac.crewRest;
  delete ac.variant;
  const variant = airframeVariant(g.seed, id, typeId, ac.builtYear);
  if (variant) ac.variant = variant;
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

// ---------- v0.8 (UPDATE-0.8.md §12): each returns the id to open ----------

export { devDeportation, devDryLease, devEvacuation, devHajj, devMixedCrew } from './contracts/missions';
export { devWorldEvent } from './ops/world';

/** A client at a level (relation and jobs set to reach it; level stored now); the client id. Dev/test helper. */
export function devLevel(g: GameState, clientId?: string, level: ClientLevel = 'trusted'): string {
  const c = (clientId && g.clients[clientId]) || Object.values(g.clients).find((x) => x.kind === 'airline' && !x.rivalId);
  if (!c) return '';
  const want = { unhappy: [-40, c.jobs ?? 0], new: [0, 0], known: [10, 1], trusted: [40, 2], partner: [70, 4] } as const;
  const [rel, jobs] = want[level];
  c.relation = rel;
  c.jobs = Math.max(jobs, level === 'new' ? 0 : c.jobs ?? 0);
  if (level === 'new') c.jobs = 0;
  c.level = level;
  return c.id;
}

/** An open offer with a strong rival bid (lands in the first half of its window); the offer id. Dev/test helper. */
export function devRivalBid(g: GameState): string {
  for (let i = 0; i < 12; i++) {
    const o = generateOffer(g, i % 2 ? 'adhoc' : 'aogCover');
    if (!o) continue;
    const r = g.rivals.find((x) => (x.status ?? 'active') === 'active' && rivalFits(x, o)) ?? g.rivals[0];
    if (!r) return o.id;
    o.firstRefusal = false;
    o.rivalBid = { rivalId: r.id, at: o.created + Math.round((o.expires - o.created) * 0.4), factor: r.priceFactor, why: r.priceFactor < 0.97 ? `quoted about ${Math.round((1 - r.priceFactor) * 100)} % under the asking rate` : 'answered first' };
    schedule(g, o.rivalBid.at, 'rival.bid', o.id);
    return o.id;
  }
  return '';
}

// ---------- v0.9 (UPDATE-0.9.md §12): each returns the id to open ----------

/** A department head unlocked now (candidates rolled, message and card); the head id. */
export function devUnlockHead(g: GameState, id: HeadId): HeadId {
  unlockHead(g, id, false);
  return id;
}

/** An achievement earned now (message, cue and any head it unlocks); its id ('' when unknown or already held). */
export function devAchievement(g: GameState, id: string): string {
  return grantAchievement(g, id);
}

/**
 * v0.9 §R: 4 A320s (crew topped up to 5 sets each), one on a Dublin wet season base, the others on daily
 * out-and-backs from base, run 20 days; returns the id of a crew member on the DUB tour ('' if none). Dev/test helper.
 */
export function devRoster(g: GameState): string {
  // Four idle A320s that can fly now (leased out, stored, delivering or already flying work is left alone: stacking
  // the scene's legs on a busy aircraft double-books it and the roster grinds).
  const busy = new Set(Object.values(g.flights).filter((f) => f.status === 'scheduled' && f.aircraftId).map((f) => f.aircraftId!));
  const free = () => Object.values(g.fleet).filter((a) => (a.status === 'available' || a.status === 'flying') && typeOf(a.typeId).family === 'A320' && !busy.has(a.id)).map((a) => a.id);
  const proto = Object.values(g.fleet).find((a) => typeOf(a.typeId).family === 'A320');
  for (let k = free().length; proto && k < 4; k++) {
    const id = nextId(g, 'a');
    g.fleet[id] = { ...structuredClone(proto), id, reg: `${g.company.regPrefix}DR${String.fromCharCode(65 + k)}`, at: g.company.homeBase, flightId: null, status: 'available', maintId: null };
  }
  const want: Partial<Record<Role, number>> = { CPT: 20, FO: 20, PUR: 20, CC: 60 };
  for (const [role, n] of Object.entries(want) as [Role, number][]) {
    const have = Object.values(g.crew).filter((c) => c.role === role && c.ratings.includes('A320')).length;
    for (let i = have; i < n; i++) {
      const c = makeCrewMember(g, role, 'A320', g.company.homeBase);
      g.crew[c.id] = c;
    }
  }
  const ids = free().slice(0, 4);
  const k = seasonBase(g, ids[0], 'DUB', 'FAO', [6 * 60, 13 * 60], 40);
  const client = Object.values(g.clients).find((c) => c.kind === 'airline');
  if (client) k.clientId = client.id;
  const home = g.company.homeBase;
  ids.slice(1).forEach((id, i) => {
    const ac = g.fleet[id];
    ac.at = home;
    const dest = ['FAO', 'FNC', 'OPO'][i % 3];
    const blk = blockMinutes(ac.typeId, home, dest);
    for (let d = 1; d < 40; d++) {
      const std = Math.floor(g.now / DAY) * DAY + d * DAY + (6 + 3 * i) * 60;
      addFlight(g, { no: ownFlightNo(g), aircraftId: id, contractId: null, kind: 'revenue', from: home, to: dest, std, sta: std + blk, pax: 150 });
      addFlight(g, { no: ownFlightNo(g), aircraftId: id, contractId: null, kind: 'revenue', from: dest, to: home, std: std + blk + 50, sta: std + 2 * blk + 50, pax: 150 });
    }
  });
  touchCrew(g);
  advanceTo(g, g.now + 20 * DAY, new Set());
  const tour = Object.values(g.pairings).find((p) => p.tour && p.contractId === k.id && p.status === 'active' && p.slots.some((s) => s.crewId));
  return tour?.slots.find((s) => s.crewId)?.crewId ?? '';
}

/**
 * v0.9 §W a one-way charter whose sector no single crew can fly (a crew change at a fuel stop priced in): Madrid–
 * Singapore on a widebody (one is added when the fleet has none), or Dili–Lisbon on a narrowbody; longer routes are
 * tried when the type's rest covers the first. The offer id ('' when none fits). Dev/test helper.
 */
export function devSlipOffer(g: GameState, routeKey: 'MAD-SIN' | 'DIL-LIS' | 'LIS-SYD' = 'MAD-SIN'): string {
  const wide = routeKey !== 'DIL-LIS';
  if (wide && !Object.values(g.fleet).some((a) => typeOf(a.typeId).body === 'wide')) devAddType(g, 'a332');
  // A narrowbody fleet can't reach Dili–Lisbon even with fuel stops: a long-range widebody is added for the scene.
  if (!wide && !Object.values(g.fleet).some((a) => typeOf(a.typeId).body === 'wide')) devAddType(g, 'a332');
  // Round 4: 'LIS-SYD' is the slip test's stop far from home (the second crew's clocks differ by hours).
  const routes: [string, string][] = routeKey === 'LIS-SYD' ? [['LIS', 'SYD']] : wide ? [['MAD', 'SIN'], ['LIS', 'SYD'], ['MAD', 'AKL'], ['LIS', 'NOU']] : [['DIL', 'LIS'], ['LIS', 'KUL'], ['LIS', 'BKK']];
  const client = Object.values(g.clients).find((c) => c.kind === 'airline' && !c.rivalId) ?? Object.values(g.clients)[0];
  if (!client) return '';
  const start = Math.ceil((g.now + 12 * DAY) / 60) * 60;
  const standing = g.company.standing;
  g.company.standing = Math.max(1, standing ?? 0) as 1 | 2;
  try {
    for (const [a, b] of routes) {
      const d: Draft = {
        archetype: 'adhoc', client, title: 'One-way charter', blurb: `A one-way charter, ${a} to ${b}.`,
        pattern: { kind: 'legs', legs: [{ from: a, to: b, dep: start, flightNo: '', pax: wide ? 250 : 150 }] },
        req: { minSeats: wide ? 250 : 150, extraCabin: 0, approvals: [] }, start, end: start + 2 * DAY, expiresIn: 5 * DAY,
        effects: {}, risk: { disruption: 0, politics: 0, permit: 0 }, paint: false, cabin: false,
      };
      const o = finalizeDraft(g, d);
      if (o?.slip) return o.id;
      if (o) delete g.offers[o.id];
    }
  } finally {
    g.company.standing = standing;
  }
  return '';
}

/**
 * v0.9 round 4 §5.3: a fleet planner (hired if need be) and a one-way job from a far station in two days whose same-day
 * positioning leaves the crew no FDP margin, then the planner's daily pass: a "position the day before" proposal and
 * its inbox message. Returns the proposal id ('' when the scene could not be built). Dev/test helper.
 */
export function devPosition(g: GameState): string {
  unlockHead(g, 'fleetPlanner', true);
  const h = g.heads!.fleetPlanner;
  if (!h.hired) hireHead(g, 'fleetPlanner', 1);
  const home = g.company.homeBase;
  const ac = Object.values(g.fleet).find((a) => a.status === 'available' && !a.flightId && typeOf(a.typeId).family === 'A320' && a.at === home);
  const client = Object.values(g.clients).find((c) => c.kind === 'airline' && !c.rivalId) ?? Object.values(g.clients)[0];
  if (!ac || !client) return '';
  const start = Math.floor(g.now / DAY) * DAY + 2 * DAY + 9 * 60;
  const standing = g.company.standing;
  g.company.standing = Math.max(1, standing ?? 0) as 1 | 2;
  try {
    for (const from of ['TLV', 'IST', 'ATH']) {
      const d: Draft = {
        archetype: 'adhoc', client, title: 'One-way charter', blurb: `A one-way charter, ${from} to ${home}.`,
        pattern: { kind: 'legs', legs: [{ from, to: home, dep: start, flightNo: '', pax: 150 }] },
        req: { minSeats: 150, extraCabin: 0, approvals: [] }, start, end: start + 2 * DAY, expiresIn: 5 * DAY,
        effects: {}, risk: { disruption: 0, politics: 0, permit: 0 }, paint: false, cabin: false,
      };
      const o = finalizeDraft(g, d);
      if (!o) continue;
      const r = acceptOffer(g, o.id, [ac.id]);
      if (!r.ok) {
        delete g.offers[o.id];
        continue;
      }
      dailyHeads(g);
      const p = h.proposals.find((x) => x.kind === 'position' && x.data.contractId === r.data!.contractId);
      if (p) return p.id;
    }
  } finally {
    g.company.standing = standing;
  }
  return '';
}

/**
 * v0.9 §T: the first crewed flight leaving within 10 h gets its captain over a limit (28-day flying by default; 'duty7d'
 * the 7-day duty sum) with every other captain away but one on standby, and the red stage posts. The
 * flight id ('' when nothing is crewed that soon). Dev/test helper.
 */
export function devCrewHours(g: GameState, limit: OohLimit = 'block28d'): string {
  const cands = Object.values(g.flights)
    .filter((f) => f.status === 'scheduled' && f.aircraftId && f.kind !== 'deadhead' && f.dutyId && f.std > g.now && f.std <= g.now + 10 * 60 && f.crewIds.length > 0 && g.fleet[f.aircraftId]?.status !== 'leasedOut')
    // A departure from base first (where a standby captain can be), then the soonest.
    .sort((a, b) => Number(b.from === g.company.homeBase) - Number(a.from === g.company.homeBase) || a.std - b.std || (a.id < b.id ? -1 : 1));
  for (const f of cands) {
    const d = g.duties[f.dutyId!];
    const p = d ? g.pairings[d.pairingId] : undefined;
    const cpt = p?.slots.find((s) => s.role === 'CPT' && s.crewId)?.crewId;
    if (!p || !cpt || d.flightIds[0] !== f.id || d.report <= g.now) continue;
    const c = g.crew[cpt];
    const week = limit === 'duty7d';
    for (let k = 1; k <= (week ? 5 : 10); k++) {
      const start = d.report - (week ? 6 - k : 25 - k) * DAY;
      c.log.push({ start, end: start + 12 * 60, fdp: 12 * 60, block: week ? 3 * 60 : 10 * 60, sectors: 2, augmented: false, disruptive: false });
    }
    c.log.sort((a, b) => a.start - b.start);
    // Every other captain away but one on standby at the departure: the card's 'Replace X: Y is on standby'.
    const fam = typeOf(g.fleet[f.aircraftId!].typeId).family;
    const crewOn = new Set(Object.values(g.pairings).flatMap((q) => q.slots.map((s) => s.crewId)));
    const sby = Object.values(g.crew).find((o) => o.role === 'CPT' && o.id !== cpt && o.ratings.includes(fam) && o.loc === f.from && !crewOn.has(o.id) && o.restUntil <= d.report - 2 * 60 && !o.blocks?.some((b) => b.from < d.release && b.to > g.now));
    for (const o of Object.values(g.crew)) if (o.role === 'CPT' && o.id !== cpt && o !== sby) o.blocks = [...(o.blocks ?? []), { from: g.now, to: g.now + 2 * DAY, why: 'leave' }];
    if (sby) sby.standby = [...(sby.standby ?? []).filter((w) => w.to <= g.now || w.from >= d.release), { from: g.now - 60, to: g.now + 11 * 60, ...(f.from === sby.base ? {} : { kind: 'hotel' as const, at: f.from }) }];
    touchCrewState(g);
    recheckPairing(g, p);
    // The scene shows the red alert itself: no routine call-out first.
    escalateShortages(g, { freeFix: false });
    return f.id;
  }
  return '';
}

/** v0.9 §Y.2: a jumbo-load offer (420–480 passengers, fuel at cost on a charter); adds a 747-400 when the fleet has none. */
export function devJumbo(g: GameState): string {
  if (!Object.values(g.fleet).some((a) => a.typeId === 'b744')) devAddType(g, 'b744');
  forceJumbo(true);
  try {
    for (let i = 0; i < 40; i++) {
      const o = generateOffer(g, (['hajj', 'troopRotation', 'repatriation', 'unRotation', 'sports'] as const)[i % 5], { wide: true });
      if (o?.jumbo) return o.id;
      if (o) delete g.offers[o.id];
    }
  } finally {
    forceJumbo(false);
  }
  return '';
}

/**
 * v0.9 §Y.1: the augmented LIS–GRU flight of devRestPlan, the crew reported, then held at the gate until the cabin
 * crew can no longer all rest in the cruise; the flight id. Dev/test helper (advances the clock to the report).
 */
export function devRestAtDeparture(g: GameState): string {
  const fid = devRestPlan(g);
  const f = g.flights[fid];
  const d0 = f?.dutyId ? g.duties[f.dutyId] : undefined;
  if (!f || !d0) return fid;
  advanceTo(g, d0.report + 5, new Set());
  for (let h = 0; h < 8; h++) {
    const d = g.flights[fid].dutyId ? g.duties[g.flights[fid].dutyId!] : undefined;
    if (!d || restPlan(g, d.id)?.ok === false || g.flights[fid].status !== 'scheduled') break;
    delayFlight(g, fid, 60, 'Technical: APU');
    settle(g);
  }
  return fid;
}

/**
 * Peak-staffing round (dev, screenshots): stages a busy month ahead. For the first aircraft's family, crew of each
 * role in `short` are let go (newest first) until next month's work is `short[role]` people more than the crew left
 * can give. Returns the heads-up's gaps.
 */
export function devPeak(g: GameState, short: Partial<Record<Role, number>> = { CC: 2 }): PeakGap[] {
  const ac = Object.values(g.fleet)[0];
  if (!ac) return [];
  const fam = typeOf(ac.typeId).family;
  const mk = monthKey(g.now) + 1;
  // Spare pursers fill cabin crew seats: trimmed to what the month needs first when cabin crew are to be short.
  const order = Object.entries(short) as [Role, number][];
  if (short.CC && short.PUR === undefined) order.unshift(['PUR', 0]);
  for (const [role, n] of order) {
    for (let i = 0; i < 200; i++) {
      const r = monthPlan(g, mk).find((m) => m.family === fam)?.roles.find((x) => x.role === role);
      if (!r || r.need - r.have >= n - (n ? 0.5 : 0.9)) break;
      const c = Object.values(g.crew).filter((x) => x.role === role && x.ratings.includes(fam) && x.status !== 'onDuty').sort((a, b) => (a.id < b.id ? 1 : -1))[0];
      if (!c) break;
      removeCrew(g, c.id, g.now, g.now + 3650 * DAY);
      // v0.12.1 paid for the part of the month worked.
      payLeaver(g, c);
      delete g.crew[c.id];
      touchCrew(g);
    }
  }
  return peakForecast(g).gaps;
}
