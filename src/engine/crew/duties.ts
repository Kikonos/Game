// Duties, pairings and deployments (DESIGN.md §5.3). An aircraft's flights are cut into units at crew-change
// stations (home base, deployment base, night-stops), partitioned into FDPs by dynamic programming, then
// chained into trips (base → base) or deployment tours (staggered crew sets on station).

import { BAL } from '../core/balance';
import { flightsOf, nextId } from '../core/entities';
import { reportMinutes, typeOf } from '../core/perf';
import { schedule } from '../core/queue';
import { DAY, dayStart, yearOf } from '../core/time';
import type { Contract, CrewMember, CrewSlot, Deployment, Duty, Flight, GameState, Legality, Minute, Pairing, Role } from '../core/types';
import { evalSegs, isDisruptive, LIMITS, localMin, longestWorkBlock, maxFdp, minRest, offsetAt, referenceTime, tzDeltaH, worst, type Seg, type TimelineCtx } from './rules';
import { crewExtraFor, seatsFor, type Seat } from './extraSeats';
import { crewCount, crewIx, dutyBlock, dutyFlights, onBlocks, restClassOf, touchCrew } from './timeline';

// ---------- duty measures ----------

interface Shape {
  report: Minute;
  release: Minute;
  fdp: number;
  sectors: number;
  longest: number;
  dep: string;
  restAt: string;
}

function shape(typeId: string, fl: Flight[], keepReport?: Minute): Shape {
  const rm = reportMinutes(typeId);
  const report = keepReport ?? fl[0].std - rm.report;
  const lastOn = onBlocks(fl[fl.length - 1]);
  let longest = 0;
  for (const f of fl) longest = Math.max(longest, f.block);
  return { report, release: lastOn + rm.post, fdp: lastOn - report, sectors: fl.length, longest, dep: fl[0].from, restAt: fl[fl.length - 1].to };
}

/** Smallest legal augmentation (0, then 1/2 when allowed and ≤ 3 sectors) and its max FDP. */
function pickAugment(sh: Shape, reportLocal: number, acclimatised: boolean, restClass: 1 | 2 | 3 | null, canAug: boolean): { augment: 0 | 1 | 2; max: number; ok: boolean } {
  const lim = (augment: 0 | 1 | 2) => maxFdp({ reportLocal, sectors: sh.sectors, acclimatised, augment, restClass, longestBlock: sh.longest });
  const opts: (0 | 1 | 2)[] = canAug && restClass && sh.sectors <= 3 ? [0, 1, 2] : [0];
  for (const a of opts) {
    const m = lim(a);
    if (sh.fdp <= m) return { augment: a, max: m, ok: true };
  }
  return { augment: 0, max: lim(0), ok: false };
}

export const canAugment = (g: GameState, restClass: 1 | 2 | 3 | null) => !!restClass && g.company.approvals.includes('augmented');

/**
 * Plan-time augmentation: the stricter of the two clocks the crew may be on at report (v0.5.2): home base for
 * the first 48 h away (FTL state B, syncDuty), the departure airport after. Cutting only by the departure clock
 * left early 4-sector days one band over the limit once measured in their pairing.
 */
function planAugment(g: GameState, sh: Shape, rc: 1 | 2 | 3 | null, canAug: boolean): ReturnType<typeof pickAugment> {
  const a = pickAugment(sh, localMin(sh.dep, sh.report), true, rc, canAug);
  const home = g.company.homeBase;
  if (!a.ok || sh.dep === home || tzDeltaH(home, sh.dep, sh.report) === 0) return a;
  const b = pickAugment(sh, localMin(home, sh.report), true, rc, canAug);
  return !b.ok || b.augment > a.augment || (b.augment === a.augment && b.max < a.max) ? b : a;
}

export function dutyLegality(d: Duty): Legality {
  const max = d.maxFdp + (d.discretion ?? 0);
  return d.fdp > max ? 'illegal' : d.fdp > max - LIMITS.tightFdp ? 'tight' : 'legal';
}

/** Re-measures a duty from its flights in its pairing's context (reference time, augmentation). */
export function syncDuty(g: GameState, d: Duty, p: Pairing): void {
  const fl = dutyFlights(g, d).filter((f) => f.status !== 'cancelled');
  if (!fl.length) return;
  const typeId = (p.aircraftId && g.fleet[p.aircraftId]?.typeId) || 'a320ceo';
  const reported = p.status === 'active' && d.report <= g.now && crewCount(p) > 0;
  const sh = shape(typeId, fl, reported ? d.report : undefined);
  const ref = referenceTime(p.base, sh.dep, Math.min(p.start, sh.report), sh.report);
  const rc = restClassOf(g, p);
  const pa = pickAugment(sh, ref.reportLocal, ref.state !== 'X', rc, canAugment(g, rc));
  d.flightIds = fl.map((f) => f.id);
  d.report = sh.report;
  d.release = sh.release;
  d.fdp = sh.fdp;
  d.sectors = sh.sectors;
  d.augment = pa.augment;
  d.maxFdp = pa.max;
  d.restAt = sh.restAt;
  d.flightsEv = fl.reduce((s, f) => s + f.ev, 0);
  d.legality = dutyLegality(d);
}

/** Crew check before report (roster.guardDuty): a 'duty.report' event this long before the report. */
export const GUARD_MIN = 120;

/** (Re)queues duty.report (and its guard check GUARD_MIN before) / duty.release; bumping ev makes older events stale. */
export function queueDuty(g: GameState, d: Duty): void {
  d.ev++;
  const first = g.flights[d.flightIds[0]];
  if (!first || first.status === 'scheduled') {
    if (d.report - GUARD_MIN > g.now) schedule(g, d.report - GUARD_MIN, 'duty.report', d.id, d.ev);
    schedule(g, Math.max(d.report, g.now), 'duty.report', d.id, d.ev);
  }
  schedule(g, Math.max(d.release, g.now), 'duty.release', d.id, d.ev);
}

/**
 * v0.5.2: a duty under way whose next leg now leaves a night-stop after the last landing (an AOG or a long hold
 * away from base) ends at that landing: the crew go to the hotel and the later legs become a duty of their own
 * (own report, FDP and rest), not one duty stretched over days. Tickets home move to the new duty. The caller
 * re-sorts the pairing (refreshPairing). The new duty, or null.
 */
export function splitUnderWay(g: GameState, p: Pairing, d: Duty): Duty | null {
  if (d.done || d.report > g.now) return null;
  const fl = dutyFlights(g, d).filter((f) => f.status !== 'cancelled');
  const typeId = (p.aircraftId && g.fleet[p.aircraftId]?.typeId) || 'a320ceo';
  const rm = reportMinutes(typeId);
  for (let i = 1; i < fl.length; i++) {
    const a = fl[i - 1];
    const b = fl[i];
    if (a.status !== 'done' || b.status !== 'scheduled') continue;
    const landed = onBlocks(a);
    const need = minRest({ dutyMin: landed - d.report, atHome: a.to === g.company.homeBase, augmented: d.augment > 0, tzShift: 0 }) + rm.report + rm.post;
    if (b.std - landed < need) continue;
    const later = fl.slice(i);
    const d2: Duty = {
      id: nextId(g, 'du'), pairingId: p.id, report: Number.MAX_SAFE_INTEGER, release: 0, flightIds: later.map((f) => f.id), deadheadIds: [], sectors: 0,
      fdp: 0, maxFdp: 0, augment: 0, restAt: '', legality: 'legal', ev: 0, flightsEv: 0,
    };
    g.duties[d2.id] = d2;
    for (const f of later) f.dutyId = d2.id;
    d.flightIds = fl.slice(0, i).map((f) => f.id);
    d2.deadheadIds = d.deadheadIds.filter((id) => (g.flights[id]?.std ?? 0) > landed);
    d.deadheadIds = d.deadheadIds.filter((id) => !d2.deadheadIds.includes(id));
    p.dutyIds.push(d2.id);
    syncDuty(g, d, p);
    syncDuty(g, d2, p);
    if (crewCount(p) > 0) {
      queueDuty(g, d);
      queueDuty(g, d2);
    }
    touchCrew(g);
    return d2;
  }
  return null;
}

// ---------- pairings ----------

const ROLE_ORDER: Role[] = ['CPT', 'FO', 'CRP', 'CSD', 'SCC', 'CC'];

/**
 * Complement for a pairing: the largest augmentation of its duties (the whole set flies every duty), the client's
 * required extra cabin crew, then the optional seats above the legal minimum (v0.6 crew-extra settings).
 */
export function pairingSeats(g: GameState, p: Pairing): Seat[] {
  const ac = p.aircraftId ? g.fleet[p.aircraftId] : undefined;
  const typeId = ac?.typeId ?? 'a320ceo';
  let augment: 0 | 1 | 2 = 0;
  let fdp = 0;
  // Cabin crew are needed only when passengers are carried: a trip of empty legs flies with its pilots.
  let empty = true;
  for (const id of p.dutyIds) {
    const d = g.duties[id];
    if (!d) continue;
    if (d.augment > augment) augment = d.augment;
    if (d.augment > 0) fdp = Math.max(fdp, d.fdp);
    for (const fid of d.flightIds) {
      const k = g.flights[fid]?.kind;
      if (k && k !== 'positioning' && k !== 'ferry') empty = false;
    }
  }
  const c: Contract | undefined = p.contractId ? g.contracts[p.contractId] : undefined;
  const x = crewExtraFor(g, p.aircraftId, p.contractId);
  const seats = seatsFor(typeId, ac?.cabin.total ?? 180, x, c?.requirements.extraCabin ?? 0, { augment, fdp, pilotsOnly: empty });
  const rank = (s: Seat) => (s.above ? 10 : 0) + ROLE_ORDER.indexOf(s.role);
  return seats.sort((a, b) => rank(a) - rank(b));
}

/** Roles of the pairing's seats (required, then above the minimum). */
export const pairingRoles = (g: GameState, p: Pairing): Role[] => pairingSeats(g, p).map((s) => s.role);

const seatKey = (s: { role: Role; above?: boolean }) => (s.above ? `${s.role}+` : s.role);

/**
 * Start/end, slots and duty measures of a pairing. Slots follow the complement: assigned crew keep a slot of
 * their role (an above-minimum holder moves into an empty required seat of a role they can fill); surplus slots
 * are dropped (their crew returned for the caller to unassign).
 */
export function refreshPairing(g: GameState, p: Pairing): string[] {
  const duties = p.dutyIds.map((id) => g.duties[id]).filter((d): d is Duty => !!d);
  duties.sort((a, b) => a.report - b.report);
  p.dutyIds = duties.map((d) => d.id);
  if (!duties.length) return [];
  if (p.status === 'planned') p.start = duties[0].report;
  for (const d of duties) if (!d.done) syncDuty(g, d, p);
  p.start = p.status === 'planned' ? duties[0].report : Math.min(p.start, duties[0].report);
  p.end = duties[duties.length - 1].release;
  const seats = pairingSeats(g, p);
  const dropped: string[] = [];
  // Extra seats (manual, above the complement) ride along unchanged after the complement's slots.
  const extras = p.slots.filter((s) => s.extra);
  const core = extras.length ? p.slots.filter((s) => !s.extra) : p.slots;
  if (seats.map(seatKey).join() !== core.map(seatKey).join()) {
    const old = core;
    const used = new Set<number>();
    const next: CrewSlot[] = seats.map((seat) => (seat.above ? { role: seat.role, crewId: null, above: true } : { role: seat.role, crewId: null }));
    // Same seat kind first, then the same role across kinds (a spare takes a required seat; a required holder an above one).
    for (const loose of [false, true]) {
      next.forEach((slot, j) => {
        if (slot.crewId) return;
        const i = old.findIndex((s, k) => !used.has(k) && s.crewId && s.role === slot.role && (loose || !!s.above === !!slot.above));
        if (i < 0) return;
        used.add(i);
        slot.crewId = old[i].crewId;
        if (old[i].locked) slot.locked = true;
        next[j] = slot;
      });
    }
    old.forEach((s, k) => {
      if (!used.has(k) && s.crewId) dropped.push(s.crewId);
    });
    p.slots = [...next, ...extras];
  }
  let lg: Legality = 'legal';
  for (const d of duties) lg = worst(lg, d.legality);
  p.legality = lg;
  delete p.illegalFrom;
  return dropped;
}

function newPairing(g: GameState, duties: Duty[], acId: string, deploymentId: string | null, tour?: Pairing['tour']): Pairing {
  const contractId = contractOfDuties(g, duties)?.id ?? null;
  const p: Pairing = {
    id: nextId(g, 'p'), aircraftId: acId, contractId, deploymentId, base: g.company.homeBase,
    start: duties[0].report, end: duties[duties.length - 1].release, dutyIds: duties.map((d) => d.id), slots: [], status: 'planned', legality: 'legal',
  };
  if (tour) p.tour = tour;
  g.pairings[p.id] = p;
  for (const d of duties) d.pairingId = p.id;
  refreshPairing(g, p);
  return p;
}

function contractOfDuties(g: GameState, duties: Duty[]): Contract | undefined {
  for (const d of duties) for (const id of d.flightIds) {
    const c = g.flights[id]?.contractId;
    if (c && g.contracts[c]) return g.contracts[c];
  }
  return undefined;
}

/**
 * Splits a pairing at t: duties reporting at or after t move to a new pairing with the same crew, seats and tour
 * (tickets stay on their duties). Lets one crew member leave from t (sickness, a manual change) while the rest of
 * the trip keeps its crew. Returns the later part, or null when one side would be empty.
 */
export function splitPairing(g: GameState, p: Pairing, t: Minute): Pairing | null {
  const ds = p.dutyIds.map((id) => g.duties[id]).filter((d): d is Duty => !!d);
  const late = ds.filter((d) => d.report >= t);
  if (!late.length || late.length === ds.length) return null;
  const q: Pairing = {
    id: nextId(g, 'p'), aircraftId: p.aircraftId, contractId: p.contractId, deploymentId: p.deploymentId, base: p.base,
    start: late[0].report, end: p.end, dutyIds: late.map((d) => d.id), slots: p.slots.map((x) => ({ ...x })), status: 'planned', legality: 'legal',
  };
  if (p.tour) q.tour = { ...p.tour };
  g.pairings[q.id] = q;
  for (const d of late) d.pairingId = q.id;
  p.dutyIds = p.dutyIds.filter((id) => !late.some((d) => d.id === id));
  if (p.deploymentId) g.deployments[p.deploymentId]?.pairingIds.push(q.id);
  // A part with a smaller complement (an empty leg flies with pilots only) lets the others go: off its
  // flights and tickets too (releaseHook), not just its slots.
  for (const id of refreshPairing(g, p)) releaseHook(g, p, id);
  for (const id of refreshPairing(g, q)) releaseHook(g, q, id);
  touchCrew(g);
  return q;
}

let releaseHook: (g: GameState, p: Pairing, crewId: string) => void = () => {};
export function setReleaseHook(f: (g: GameState, p: Pairing, crewId: string) => void): void {
  releaseHook = f;
}

/** Deletes a pairing record (caller has already released its crew and tickets). */
export function deletePairing(g: GameState, p: Pairing): void {
  for (const id of p.dutyIds) {
    const d = g.duties[id];
    if (!d || d.pairingId !== p.id) continue;
    for (const fid of d.flightIds) {
      const f = g.flights[fid];
      if (f && f.dutyId === d.id) f.dutyId = null;
    }
    delete g.duties[id];
  }
  if (p.deploymentId) {
    const dep = g.deployments[p.deploymentId];
    if (dep) dep.pairingIds = dep.pairingIds.filter((x) => x !== p.id);
  }
  delete g.pairings[p.id];
}

// ---------- building ----------

interface Spec {
  flights: Flight[];
}

const keyOf = (fl: Flight[]) => fl.map((f) => f.id).join(',');

/** Fewest duties, then least augmentation, then the most slack on the tightest duty (DESIGN §5.3 step 3). */
function partition(g: GameState, typeId: string, units: Flight[][]): Spec[] {
  const rc = typeOf(typeId).restClass;
  const canAug = canAugment(g, rc);
  const allowTight = g.company.policies.allowTight;
  interface Best { count: number; aug: number; slack: number; prev: number; flights: Flight[] }
  const best: (Best | null)[] = new Array(units.length + 1).fill(null);
  best[0] = { count: 0, aug: 0, slack: Infinity, prev: -1, flights: [] };
  for (let j = 1; j <= units.length; j++) {
    let fl: Flight[] = [];
    for (let i = j - 1; i >= 0; i--) {
      fl = [...units[i], ...fl];
      const sh = shape(typeId, fl);
      const single = i === j - 1;
      if (!single && sh.fdp > 19 * 60) break;
      const pa = planAugment(g, sh, rc, canAug);
      const tight = sh.fdp > pa.max - LIMITS.tightFdp;
      if (!single && (!pa.ok || (tight && !allowTight))) continue;
      const prev = best[i];
      if (!prev) continue;
      const cand: Best = { count: prev.count + 1, aug: prev.aug + pa.augment, slack: Math.min(prev.slack, pa.max - sh.fdp), prev: i, flights: fl };
      const cur = best[j];
      if (!cur || cand.count < cur.count || (cand.count === cur.count && (cand.aug < cur.aug || (cand.aug === cur.aug && cand.slack > cur.slack)))) best[j] = cand;
    }
  }
  const out: Spec[] = [];
  for (let j = units.length; j > 0; ) {
    const b = best[j]!;
    out.push({ flights: b.flights });
    j = b.prev;
  }
  return out.reverse();
}

/**
 * A unit too long for any legal duty (a positioning leg straight into a long sector, say) is cut at its sector
 * boundaries so a fresh crew can join at the outstation ("slip crew": positioned in by ticket, the other crew rests
 * there). Never at a fuel stop: a revenue sector and its tech-stop legs stay one chain.
 */
function slipUnits(g: GameState, typeId: string, u: Flight[]): Flight[][] {
  if (u.length < 2) return [u];
  const sh = shape(typeId, u);
  const rc = typeOf(typeId).restClass;
  if (planAugment(g, sh, rc, canAugment(g, rc)).ok) return [u];
  const out: Flight[][] = [];
  let cur: Flight[] = [];
  for (const f of u) {
    if (cur.length && f.kind !== 'techstop') {
      out.push(cur);
      cur = [];
    }
    cur.push(f);
  }
  if (cur.length) out.push(cur);
  return out;
}

const isDeploymentContract = (g: GameState, c: Contract | undefined): c is Contract & { pattern: { kind: 'base'; base: string } } =>
  !!c && c.pattern.kind === 'base' && c.pattern.base !== g.company.homeBase;

/**
 * Rebuilds the open (uncrewed, planned) pairings of an aircraft from `from` on: free flights → units → duties →
 * trips and deployment tours. Crewed pairings are kept. Duties whose flights did not change keep their ids.
 */
export function planAircraft(g: GameState, acId: string, from: Minute): void {
  const ac = g.fleet[acId];
  if (!ac) return;
  const typeId = ac.typeId;
  const home = g.company.homeBase;
  const ix = crewIx(g);
  const old = new Map<string, Duty>();
  for (const p of [...(ix.byAircraft.get(acId) ?? [])]) {
    if (p.status !== 'planned' || p.start < from || crewCount(p) > 0) continue;
    for (const did of p.dutyIds) {
      const d = g.duties[did];
      if (d) old.set(d.flightIds.join(','), d);
    }
    deletePairing(g, p);
  }
  touchCrew(g);
  absorbTrailing(g, acId, from);
  const inDuty = new Set<string>();
  for (const p of crewIx(g).byAircraft.get(acId) ?? []) for (const did of p.dutyIds) for (const fid of g.duties[did]?.flightIds ?? []) inDuty.add(fid);

  const all = flightsOf(g, acId).filter((f) => f.status !== 'cancelled' && f.aircraftId === acId);
  const stations = new Set([home]);
  for (const f of all) {
    const c = f.contractId ? g.contracts[f.contractId] : undefined;
    if (c && c.pattern.kind === 'base') stations.add(c.pattern.base);
  }
  const rm = reportMinutes(typeId);
  // Runs of consecutive free flights; a long ground gap (night-stop) or a crewed flight ends a run.
  const runs: Flight[][] = [];
  let run: Flight[] = [];
  for (const f of all) {
    const free = f.status === 'scheduled' && f.std >= from && !inDuty.has(f.id);
    if (!free) {
      if (run.length) runs.push(run);
      run = [];
      continue;
    }
    const prev = run[run.length - 1];
    if (prev) {
      const gapNeed = minRest({ dutyMin: 0, atHome: prev.to === home, augmented: false, tzShift: 0 }) + rm.report + rm.post;
      if (f.std - prev.sta >= gapNeed || prev.to !== f.from) {
        runs.push(run);
        run = [];
      }
    }
    run.push(f);
  }
  if (run.length) runs.push(run);

  const specs: Spec[] = [];
  for (const r of runs) {
    const units: Flight[][] = [];
    let u: Flight[] = [];
    for (let i = 0; i < r.length; i++) {
      u.push(r[i]);
      if (i < r.length - 1 && stations.has(r[i].to)) {
        units.push(u);
        u = [];
      }
    }
    if (u.length) units.push(u);
    specs.push(...partition(g, typeId, units.flatMap((x) => slipUnits(g, typeId, x))));
  }

  // Duty records (reused when the flights are the same).
  const trips: Duty[] = [];
  const byDep = new Map<string, Duty[]>();
  for (const s of specs) {
    const k = keyOf(s.flights);
    const o = old.get(k);
    const d: Duty = o ?? {
      id: nextId(g, 'du'), pairingId: '', report: 0, release: 0, flightIds: s.flights.map((f) => f.id), deadheadIds: [], sectors: 0, fdp: 0, maxFdp: 0,
      augment: 0, restAt: '', legality: 'legal', ev: 0, flightsEv: 0,
    };
    d.flightIds = s.flights.map((f) => f.id);
    d.deadheadIds = [];
    delete d.done;
    g.duties[d.id] = d;
    for (const f of s.flights) f.dutyId = d.id;
    // Provisional measures (the stricter clock); refreshPairing re-measures in pairing context.
    const sh = shape(typeId, s.flights);
    const rc = typeOf(typeId).restClass;
    const pa = planAugment(g, sh, rc, canAugment(g, rc));
    Object.assign(d, { report: sh.report, release: sh.release, fdp: sh.fdp, sectors: sh.sectors, augment: pa.augment, maxFdp: pa.max, restAt: sh.restAt });
    d.flightsEv = s.flights.reduce((n, f) => n + f.ev, 0);
    d.legality = dutyLegality(d);
    const c = contractOfDuties(g, [d]);
    // v0.5.2: an empty leg into a deployment from an outstation is a pilots-only ferry: the tour's cabin crew
    // deadhead straight to the base instead of first flying out to the aircraft (from home they ride along).
    const remoteIn = isDeploymentContract(g, c) && emptyDuty(g, d) && g.flights[d.flightIds[0]]?.from !== home && !specs.some((x) => x.flights[0].std < s.flights[0].std && x.flights.some((f) => f.contractId === c.id && f.kind !== 'positioning' && f.kind !== 'ferry'));
    if (isDeploymentContract(g, c) && !remoteIn) {
      const l = byDep.get(c.id) ?? [];
      l.push(d);
      byDep.set(c.id, l);
    } else trips.push(d);
  }
  for (const [cid, duties] of byDep) {
    const left = chainDeployment(g, g.contracts[cid], acId, duties);
    trips.push(...left);
  }
  trips.sort((a, b) => a.report - b.report);
  buildTrips(g, acId, trips);
  touchCrew(g);
}

/**
 * Empty legs planned (or re-planned) right after a crewed duty, from where it ends (the positioning home after a
 * job): the duty's own crew fly them when the FDP and their timelines allow, instead of a fresh crew positioned in
 * while they ride home on tickets. Their tickets home are re-planned (retickHook).
 */
function absorbTrailing(g: GameState, acId: string, from: Minute): void {
  const ix = crewIx(g);
  const fl = flightsOf(g, acId).filter((f) => f.status === 'scheduled' && f.aircraftId === acId && f.std >= from && !ix.inDuty.has(f.id));
  if (!fl.length) return;
  for (const p of [...(ix.byAircraft.get(acId) ?? [])]) {
    if (crewCount(p) === 0 || p.status === 'done' || p.status === 'broken') continue;
    const open = p.dutyIds.map((id) => g.duties[id]).filter((d): d is Duty => !!d && !d.done).sort((a, b) => a.report - b.report);
    const d = open[open.length - 1];
    const lastF = d && g.flights[d.flightIds[d.flightIds.length - 1]];
    if (!d || !lastF || lastF.status === 'cancelled') continue;
    const add: Flight[] = [];
    let at = d.restAt;
    let t = onBlocks(lastF);
    for (const f of fl) {
      if (f.std < t) continue;
      if (f.from !== at || f.std - t > 3 * 60 || (f.kind !== 'positioning' && f.kind !== 'ferry')) break;
      add.push(f);
      at = f.to;
      t = f.sta;
    }
    if (!add.length) continue;
    const before = [...d.flightIds];
    d.flightIds = [...before, ...add.map((f) => f.id)];
    syncDuty(g, d, p);
    touchCrew(g);
    let ok = d.legality !== 'illegal';
    for (const s of p.slots) {
      const c = s.crewId ? g.crew[s.crewId] : undefined;
      if (!ok || !c) continue;
      if (crewTrailOkHook && !crewTrailOkHook(g, p, c)) ok = false;
    }
    if (!ok) {
      d.flightIds = before;
      syncDuty(g, d, p);
      touchCrew(g);
      continue;
    }
    for (const f of add) f.dutyId = d.id;
    refreshPairing(g, p);
    queueDuty(g, d);
    retickHook(g, p);
    touchCrew(g);
  }
}

/** Hook (roster.ts): can crew member c fly pairing p as it now stands (its tickets home will be re-planned)? */
let crewTrailOkHook: ((g: GameState, p: Pairing, c: CrewMember) => boolean) | null = null;
export function setCrewTrailOkHook(f: (g: GameState, p: Pairing, c: CrewMember) => boolean): void {
  crewTrailOkHook = f;
}

/** Only empty legs (positioning / ferry): flown with pilots only when it is a trip of its own. */
function emptyDuty(g: GameState, d: Duty): boolean {
  return d.flightIds.every((id) => {
    const k = g.flights[id]?.kind;
    return k === 'positioning' || k === 'ferry';
  });
}

/** Trips: from a duty until one releases at home base, a > 3-day gap, or 6 duty days (then 2 days off). */
function buildTrips(g: GameState, acId: string, duties: Duty[]): void {
  const home = g.company.homeBase;
  const dayOf = (t: Minute) => Math.floor((t + offsetAt(home, t)) / DAY);
  let cur: Duty[] = [];
  const empty = (d: Duty) => emptyDuty(g, d);
  // v0.5.2: empty duties after the trip's last revenue duty are their own pilots-only trip (a ferry: the cabin
  // crew aren't needed at the destination and go home by ticket; the pilots usually fly on, crew.planCrew drop).
  const close = () => {
    let k = cur.length;
    while (k > 0 && empty(cur[k - 1])) k--;
    if (k > 0 && k < cur.length) {
      newPairing(g, cur.slice(0, k), acId, null);
      newPairing(g, cur.slice(k), acId, null);
    } else if (cur.length) newPairing(g, cur, acId, null);
    cur = [];
  };
  for (const d of duties) {
    if (cur.length) {
      const last = cur[cur.length - 1];
      const firstDep = g.flights[d.flightIds[0]]?.from;
      const days = new Set(cur.map((x) => dayOf(x.report)));
      days.add(dayOf(d.report));
      const cont = last.restAt !== home && firstDep === last.restAt && d.report - last.release <= 3 * DAY && d.report - last.release >= 10 * 60 && days.size <= LIMITS.blockDays;
      if (!cont) close();
    }
    cur.push(d);
    if (d.restAt === home) close();
  }
  close();
}

// ---------- deployments ----------

const rotation = (g: GameState) => g.company.policies.rotationWeeks * 7 * DAY;

/** On-station period of set s that contains t (null before the set exists). */
export function periodOf(dep: Deployment, s: number, t: Minute, R: number): { from: Minute; to: Minute } | null {
  const a = dep.anchors?.[s];
  if (a === undefined) return null;
  if (t < a) {
    const from = Math.max(dep.start, a - R);
    return t < from ? null : { from, to: a };
  }
  const k = Math.floor((t - a) / R);
  return { from: a + k * R, to: a + (k + 1) * R };
}

function anchorsFor(start: Minute, sets: number, R: number): Minute[] {
  const out: Minute[] = [];
  for (let s = 0; s < sets; s++) out.push(start + Math.max(1, Math.round(((s + 1) * R) / sets / DAY)) * DAY);
  return out;
}

interface TourState {
  set: number;
  from: Minute;
  to: Minute;
  pairing: Pairing | null;
  duties: Duty[];
  segs: Seg[];
  days: number[];
}

/** A duty as a virtual crew set's seg (no tickets). */
function virtualSeg(g: GameState, d: Duty, tripStart: Minute, base: string, fresh = false): Seg {
  const dep = g.flights[d.flightIds[0]]?.from ?? d.restAt;
  const tz = referenceTime(base, dep, Math.min(tripStart, d.report), d.report).tz;
  return {
    kind: 'duty', start: d.report, end: d.release, fdp: d.fdp, maxFdp: d.maxFdp + (d.discretion ?? 0), block: dutyBlock(g, d), sectors: d.sectors,
    aug: d.augment > 0, disruptive: isDisruptive(tz, d.report, d.release),
    rest: minRest({ dutyMin: d.release - d.report, atHome: d.restAt === base, augmented: d.augment > 0, tzShift: tzDeltaH(base, d.restAt, d.release) }),
    at: d.restAt, from: dep, dutyId: d.id, fresh,
  };
}

interface Chainer {
  take(d: Duty): boolean;
  tours: Map<string, TourState>;
}

/**
 * Round-robin chaining: each duty (report order) goes to the on-station set free longest (earliest rest end)
 * that stays legal (rest, FDP, cumulative, recovery, 6-on/2-off); ties by set index. Crewed tours also check
 * their real crew (via `crewOk`).
 */
function chainer(g: GameState, dep: Deployment, crewOk: (p: Pairing, d: Duty) => boolean): Chainer {
  const R = rotation(g);
  const home = g.company.homeBase;
  const dayOf = (t: Minute) => Math.floor((t + offsetAt(dep.base, t)) / DAY);
  const tours = new Map<string, TourState>();
  for (const pid of dep.pairingIds) {
    const p = g.pairings[pid];
    if (!p?.tour) continue;
    const duties = p.dutyIds.map((id) => g.duties[id]).filter((d): d is Duty => !!d);
    tours.set(`${p.tour.set}:${p.tour.from}`, {
      set: p.tour.set, from: p.tour.from, to: p.tour.to, pairing: p, duties,
      segs: duties.map((d) => virtualSeg(g, d, p.start, home)), days: [...new Set(duties.map((d) => dayOf(d.report)))].sort((a, b) => a - b),
    });
  }
  const take = (d: Duty): boolean => {
    let pick: TourState | null = null;
    let pickRest = Infinity;
    const sets = dep.anchors?.length ?? 0;
    for (let s = 0; s < sets; s++) {
      const per = periodOf(dep, s, d.report, R);
      if (!per) continue;
      const key = `${s}:${per.from}`;
      const st = tours.get(key) ?? { set: s, from: per.from, to: per.to, pairing: null, duties: [], segs: [], days: [] };
      const day = dayOf(d.report);
      const days = st.days.includes(day) ? st.days : [...st.days, day].sort((a, b) => a - b);
      if (longestWorkBlock(days) > LIMITS.blockDays) continue;
      const tripStart = Math.min(st.duties[0]?.report ?? d.report, d.report);
      const i = st.segs.findIndex((x) => x.start > d.report);
      const at = i < 0 ? st.segs.length : i;
      const last = st.segs[at - 1];
      const segs = [...st.segs.slice(0, at), virtualSeg(g, d, tripStart, home, true), ...st.segs.slice(at)];
      // A fresh set arrives rested the day before its period (positioning counts as duty).
      const ctx: TimelineCtx = { base: home, restUntil: -Infinity, lastRecovery: per.from - DAY, blockYear: 0, blockYearOf: yearOf(d.report), slack: BAL.rosterSlack };
      if (evalSegs(ctx, segs).some((i) => i.level === 'illegal' && i.code !== 'fdp')) continue;
      if (st.pairing && crewCount(st.pairing) > 0 && !crewOk(st.pairing, d)) continue;
      const restEnd = last ? last.end + last.rest : -Infinity;
      if (restEnd < pickRest) {
        pick = st;
        pickRest = restEnd;
      }
    }
    if (!pick) return false;
    const key = `${pick.set}:${pick.from}`;
    tours.set(key, pick);
    pick.duties.push(d);
    pick.duties.sort((x, y) => x.report - y.report);
    pick.segs.push(virtualSeg(g, d, pick.duties[0].report, home));
    pick.segs.sort((x, y) => x.start - y.start);
    const day = dayOf(d.report);
    if (!pick.days.includes(day)) pick.days = [...pick.days, day].sort((a, b) => a - b);
    return true;
  };
  return { take, tours };
}

/** Hook for crewed tours (set by roster.ts to avoid an import cycle): can every crew member of p also fly d? */
let crewOkHook: (g: GameState, p: Pairing, d: Duty) => boolean = () => true;
export function setCrewOkHook(f: (g: GameState, p: Pairing, d: Duty) => boolean): void {
  crewOkHook = f;
}

/** Hook (roster.ts): re-plans the crew's tickets after a crewed tour grew past its ends (the ticket home moves). */
let retickHook: (g: GameState, p: Pairing) => void = () => {};
export function setRetickHook(f: (g: GameState, p: Pairing) => void): void {
  retickHook = f;
}

/**
 * Places free deployment duties into tours (creating the deployment and sizing its sets on first use).
 * Returns the duties no set can legally take (they become trips).
 */
function chainDeployment(g: GameState, c: Contract, acId: string, duties: Duty[]): Duty[] {
  if (c.pattern.kind !== 'base') return duties;
  const base = c.pattern.base;
  const R = rotation(g);
  duties.sort((a, b) => a.report - b.report || (a.id < b.id ? -1 : 1));
  let dep = Object.values(g.deployments).find((x) => x.contractId === c.id && x.aircraftId === acId);
  if (!dep) {
    const start = dayStart(duties[0].report);
    dep = { id: nextId(g, 'dp'), contractId: c.id, aircraftId: acId, base, start, end: Math.max(c.end, duties[duties.length - 1].release), setsOnStation: 0, pairingIds: [] };
    // setsOnStation = max(peak duties/day × 8/6, BH per 28 days / 85), +1 while chaining can't cover the days.
    const perDay = new Map<number, number>();
    let bh = 0;
    for (const d of duties) {
      const k = Math.floor((d.report + offsetAt(base, d.report)) / DAY);
      perDay.set(k, (perDay.get(k) ?? 0) + 1);
      if (d.report < start + 28 * DAY) bh += dutyBlock(g, d);
    }
    const span = Math.min(28, Math.max(14, (duties[duties.length - 1].release - start) / DAY));
    const peak = Math.max(...perDay.values());
    let sets = Math.max(1, Math.ceil((peak * 8) / 6), Math.ceil((bh / 60) * (28 / span) / BAL.cabinBHMonth));
    for (; sets < BAL.maxSetsOnStation; sets++) {
      const trial: Deployment = { ...dep, anchors: anchorsFor(start, sets, R), pairingIds: [] };
      const ch = chainer(g, trial, () => true);
      if (duties.every((d) => ch.take(d))) break;
    }
    dep.setsOnStation = sets;
    dep.sized = sets;
    dep.anchors = anchorsFor(start, sets, R);
    g.deployments[dep.id] = dep;
  }
  dep.sized ??= dep.setsOnStation;
  dep.anchors ??= anchorsFor(dep.start, dep.setsOnStation, R);
  dep.end = Math.max(dep.end, duties[duties.length - 1].release);
  const ch = chainer(g, dep, (p, d) => crewOkHook(g, p, d));
  const left: Duty[] = [];
  for (const d of duties) {
    if (ch.take(d)) continue;
    // One extra set at most beyond the sizing (a whole tour of crew for a stray duty is waste: it flies as a
    // trip from base instead); a duty before the deployment's start can't join any set.
    if (d.report >= dep.start && dep.anchors.length < Math.min(BAL.maxSetsOnStation, dep.sized + 1)) {
      dep.anchors.push(dayStart(d.report) + R);
      dep.setsOnStation = dep.anchors.length;
      if (ch.take(d)) continue;
    }
    left.push(d);
  }
  for (const st of ch.tours.values()) {
    if (st.pairing) {
      const p = st.pairing;
      const fresh = st.duties.filter((d) => !p.dutyIds.includes(d.id));
      if (!fresh.length) continue;
      const [from, to] = [p.start, p.end];
      for (const d of fresh) d.pairingId = p.id;
      p.dutyIds.push(...fresh.map((d) => d.id));
      refreshPairing(g, p);
      if (crewCount(p) > 0) {
        for (const d of fresh) queueDuty(g, d);
        // Duties past the old ends: the crew stay on (tickets out/home move with the tour).
        if (fresh.some((d) => d.report < from || d.release > to)) retickHook(g, p);
      }
      continue;
    }
    if (!st.duties.length) continue;
    const p = newPairing(g, st.duties, acId, dep.id, { set: st.set, from: st.from, to: st.to });
    dep.pairingIds.push(p.id);
  }
  dep.pairingIds.sort((a, b) => {
    const x = g.pairings[a]?.tour;
    const y = g.pairings[b]?.tour;
    return (x?.from ?? 0) - (y?.from ?? 0) || (x?.set ?? 0) - (y?.set ?? 0);
  });
  return left;
}

/** Builds (or keeps) the aircraft's duties from `from` and returns those overlapping [from, to), in time order. */
export function buildDuties(g: GameState, aircraftId: string, from: Minute, to: Minute): Duty[] {
  planAircraft(g, aircraftId, from);
  const out: Duty[] = [];
  for (const p of crewIx(g).byAircraft.get(aircraftId) ?? []) {
    for (const id of p.dutyIds) {
      const d = g.duties[id];
      if (d && d.release > from && d.report < to) out.push(d);
    }
  }
  return out.sort((a, b) => a.report - b.report);
}
