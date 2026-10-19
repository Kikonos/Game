// Auto-roster, change sync and disruption APIs (B2). DESIGN.md §4.2, §5.3.

import { BAL } from '../core/balance';
import { addDeadhead, cancelFlight, flightsOf } from '../core/entities';
import { post } from '../core/ledger';
import { pushMessage } from '../core/messages';
import { requestPause } from '../core/pause';
import { canFill, complement, typeOf } from '../core/perf';
import { DAY, fmtDateTime } from '../core/time';
import type { ActionResult, CrewMember, Duty, Flight, GameState, Legality, Minute, Pairing, Role } from '../core/types';
import { acceptable, mergeSegs, openDuties, planCrew, type CrewPlan } from './check';
import { deletePairing, dutyLegality, planAircraft, queueDuty, refreshPairing, setCrewOkHook, syncDuty } from './duties';
import { evalSegs, levelOf, worst, type Seg } from './rules';
import { block28, crewCount, crewIx, ctxOf, dhBlock, dutySegs, locAt, segsOf, ticketPrice, touchCrew, typeIdOf } from './timeline';

export { buildDuties } from './duties';

export interface RosterResult {
  /** Slots filled. */
  assigned: number;
  /** Flights still missing crew. */
  uncovered: string[];
  deadheads: number;
  /** Ticket + hotel cost committed. */
  cost: number;
}

const emptyResult = (): RosterResult => ({ assigned: 0, uncovered: [], deadheads: 0, cost: 0 });

const SLOT_ORDER: Role[] = ['CPT', 'FO', 'CRP', 'CSD', 'SCC', 'CC'];

/** On wet leases the client buys crew tickets and hotels (RESEARCH §2.2). */
export function clientPaysCrewTravel(g: GameState, p: Pairing | undefined): boolean {
  const c = p?.contractId ? g.contracts[p.contractId] : undefined;
  return c?.product.kind === 'wet';
}

// ---------- crew on pairings ----------

/** Operating crew on the pairing's flights still to fly. */
function setFlightsCrew(g: GameState, p: Pairing): void {
  const ids = p.slots.filter((s) => s.crewId).map((s) => s.crewId!);
  for (const d of openDuties(g, p)) {
    for (const fid of d.flightIds) {
      const f = g.flights[fid];
      if (f && f.status === 'scheduled') {
        f.crewIds = [...ids];
        f.dutyId = d.id;
      }
    }
  }
}

type TicketLike = { from: string; to: string; std: Minute; sta: Minute };

/** Buys a ticket for a group and attaches it to a duty; cost posted to 'deadhead' unless the client pays. */
function buyTicket(g: GameState, p: Pairing, d: Duty, crewIds: string[], t: TicketLike, res: RosterResult): Flight {
  const cost = clientPaysCrewTravel(g, p) ? 0 : ticketPrice(t.from, t.to) * crewIds.length;
  const f = addDeadhead(g, { crewIds, from: t.from, to: t.to, std: t.std, sta: t.sta, cost, contractId: p.contractId });
  if (cost) post(g, 'deadhead', -cost);
  d.deadheadIds.push(f.id);
  res.deadheads++;
  res.cost += cost;
  return f;
}

/** Groups the planned tickets of newly assigned crew (one ticket per group travelling together). */
function buyTickets(g: GameState, p: Pairing, plans: Map<string, CrewPlan>, res: RosterResult): void {
  const duties = openDuties(g, p);
  if (!duties.length) return;
  const first = duties[0];
  const last = duties[duties.length - 1];
  const groups = new Map<string, { d: Duty; t: TicketLike; ids: string[] }>();
  for (const [id, plan] of plans) {
    for (const [t, d] of [[plan.out, first], [plan.home, last]] as const) {
      if (!t) continue;
      const k = `${d.id}:${t.from}:${t.to}:${t.std}`;
      const gr = groups.get(k) ?? { d, t, ids: [] };
      gr.ids.push(id);
      groups.set(k, gr);
    }
  }
  for (const gr of groups.values()) buyTicket(g, p, gr.d, gr.ids, gr.t, res);
}

/** Takes a crew member off a pairing: slot, flights still to fly and unused tickets (cancelled when empty). */
export function releaseCrew(g: GameState, p: Pairing, crewId: string): void {
  for (const s of p.slots) if (s.crewId === crewId) s.crewId = null;
  for (const id of p.dutyIds) {
    const d = g.duties[id];
    if (!d || d.done) continue;
    for (const fid of d.flightIds) {
      const f = g.flights[fid];
      if (f && f.status === 'scheduled') f.crewIds = f.crewIds.filter((x) => x !== crewId);
    }
    for (const fid of [...d.deadheadIds]) {
      const f = g.flights[fid];
      if (!f || f.status !== 'scheduled' || !f.crewIds.includes(crewId)) continue;
      f.crewIds = f.crewIds.filter((x) => x !== crewId);
      if (!f.crewIds.length) {
        cancelFlight(g, f, 'Crew change');
        d.deadheadIds = d.deadheadIds.filter((x) => x !== fid);
      }
    }
  }
  touchCrew(g);
  const c = g.crew[crewId];
  if (c && p.status === 'active') sendHome(g, c, p);
}

/** A crew member left away from base without a plan gets a ticket home after rest. */
function sendHome(g: GameState, c: CrewMember, p?: Pairing): void {
  if (c.loc === c.base) return;
  const ix = crewIx(g);
  if ((ix.tickets.get(c.id) ?? []).some((f) => f.status === 'scheduled')) return;
  if ((ix.pairingsOf.get(c.id) ?? []).some((x) => x.status === 'active' || (x.status === 'planned' && x.start < g.now + 3 * DAY))) return;
  const blk = dhBlock(c.loc, c.base);
  const std = Math.ceil((Math.max(g.now, c.restUntil) + 60) / 60) * 60;
  const cost = clientPaysCrewTravel(g, p) ? 0 : ticketPrice(c.loc, c.base);
  addDeadhead(g, { crewIds: [c.id], from: c.loc, to: c.base, std, sta: std + blk, cost, contractId: p?.contractId ?? null });
  if (cost) post(g, 'deadhead', -cost);
  touchCrew(g);
}

/** Removes a duty from its pairing; its tickets move to the pairing's new first/last duty. */
function detachDuty(g: GameState, p: Pairing, d: Duty): void {
  p.dutyIds = p.dutyIds.filter((x) => x !== d.id);
  const rest = openDuties(g, p);
  for (const fid of d.deadheadIds) {
    const f = g.flights[fid];
    if (!f || !rest.length) continue;
    const target = f.sta <= d.report ? rest[0] : rest[rest.length - 1];
    target.deadheadIds.push(fid);
  }
  for (const fid of d.flightIds) {
    const f = g.flights[fid];
    if (f && f.dutyId === d.id) {
      f.dutyId = null;
      if (f.status === 'scheduled') f.crewIds = [];
    }
  }
  delete g.duties[d.id];
  touchCrew(g);
}

function dissolve(g: GameState, p: Pairing): void {
  for (const s of p.slots) if (s.crewId) releaseCrew(g, p, s.crewId);
  deletePairing(g, p);
  touchCrew(g);
}

/**
 * Worst of the duty limits and every assigned crew member's legality (stored on the pairing). `priorOnly`
 * ignores the crew's later work, so a conflict frees the crew from the later pairing (re-roster order).
 */
export function recheckPairing(g: GameState, p: Pairing, priorOnly = false): { level: Legality; illegal: string[] } {
  let level: Legality = 'legal';
  for (const d of openDuties(g, p)) level = worst(level, d.legality);
  const illegal: string[] = [];
  for (const s of p.slots) {
    if (!s.crewId) continue;
    const c = g.crew[s.crewId];
    if (!c) continue;
    const base = segsOf(g, c, p.id);
    const plan = planCrew(g, c, p, priorOnly ? base.filter((x) => x.start < p.start) : base, true);
    const crewLevel = levelOf(plan.issues.filter((i) => i.code !== 'fdp'));
    if (crewLevel === 'illegal') illegal.push(c.id);
    level = worst(level, crewLevel);
  }
  p.legality = level;
  return { level, illegal };
}

// ---------- auto-roster ----------

/** Per-run cache of crew timelines (updated as slots are filled; no index churn inside the loop). */
class Ctx {
  segs = new Map<string, Seg[]>();
  crew: CrewMember[];
  constructor(readonly g: GameState) {
    this.crew = Object.values(g.crew);
  }
  of(c: CrewMember): Seg[] {
    let s = this.segs.get(c.id);
    if (!s) this.segs.set(c.id, (s = segsOf(this.g, c)));
    return s;
  }
  add(c: CrewMember, segs: Seg[]): void {
    this.segs.set(c.id, mergeSegs(this.of(c), segs.map((x) => ({ ...x, fresh: false }))));
  }
}

/** Crew who flew the aircraft's or contract's previous pairing (crew family bonus). */
function previousCrew(g: GameState, p: Pairing): Set<string> {
  let best: Pairing | null = null;
  for (const q of crewIx(g).byAircraft.get(p.aircraftId ?? '') ?? []) {
    if (q.id === p.id || q.start >= p.start || crewCount(q) === 0) continue;
    if (!best || q.start > best.start) best = q;
  }
  return new Set(best ? best.slots.filter((s) => s.crewId).map((s) => s.crewId!) : []);
}

/** Fills a pairing's empty slots with the best-scoring legal crew (DESIGN §5.3 steps 1–4, 6). */
function fillPairing(g: GameState, ctx: Ctx, p: Pairing, res: RosterResult, exclude?: Set<string>): void {
  const duties = openDuties(g, p);
  if (!duties.length) return;
  const first = duties[0];
  const dep = g.flights[first.flightIds[0]]?.from ?? first.restAt;
  const family = typeOf(typeIdOf(g, p)).family;
  const contract = p.contractId ? g.contracts[p.contractId] : undefined;
  const unpleasant = (contract?.effects.morale ?? 0) < 0;
  const prev = previousCrew(g, p);
  const hadCrew = crewCount(p) > 0;
  const inP = new Set(p.slots.filter((s) => s.crewId).map((s) => s.crewId!));
  const order = p.slots.map((_, i) => i).filter((i) => !p.slots[i].crewId);
  order.sort((a, b) => SLOT_ORDER.indexOf(p.slots[a].role) - SLOT_ORDER.indexOf(p.slots[b].role) || a - b);
  const plans = new Map<string, CrewPlan>();
  for (const si of order) {
    const slot = p.slots[si];
    const cands: { c: CrewMember; score: number }[] = [];
    for (const c of ctx.crew) {
      if (!canFill(slot.role, c.role) || !c.ratings.includes(family) || inP.has(c.id) || exclude?.has(c.id)) continue;
      const segs = ctx.of(c);
      const loc = locAt(c, segs, first.report);
      let score = -ticketPrice(loc, dep) - 2 * (block28(segs, first.report) / 60);
      if (prev.has(c.id)) score += 30;
      if (c.role !== slot.role) score -= 50;
      if (unpleasant) score -= (70 - c.morale) / 2;
      cands.push({ c, score });
    }
    cands.sort((a, b) => b.score - a.score || (a.c.id < b.c.id ? -1 : a.c.id > b.c.id ? 1 : 0));
    for (const { c } of cands) {
      const plan = planCrew(g, c, p, ctx.of(c));
      if (!acceptable(g, plan)) continue;
      slot.crewId = c.id;
      inP.add(c.id);
      plans.set(c.id, plan);
      ctx.add(c, plan.segs);
      res.assigned++;
      break;
    }
  }
  if (!plans.size) return;
  buyTickets(g, p, plans, res);
  setFlightsCrew(g, p);
  if (!hadCrew) for (const d of duties) queueDuty(g, d);
  let level: Legality = 'legal';
  for (const d of duties) level = worst(level, d.legality);
  for (const plan of plans.values()) level = worst(level, levelOf(plan.issues.filter((i) => i.code !== 'fdp')));
  p.legality = hadCrew ? worst(level, p.legality) : level;
}

/** Flights of pairings with empty slots (still to fly, std in [from, to)). */
function uncoveredOf(g: GameState, ps: Pairing[], from: Minute, to: Minute): string[] {
  const out: string[] = [];
  for (const p of ps) {
    if (!g.pairings[p.id] || !p.slots.some((s) => !s.crewId)) continue;
    for (const d of openDuties(g, p)) for (const fid of d.flightIds) {
      const f = g.flights[fid];
      if (f && f.status === 'scheduled' && f.std >= from && f.std < to) out.push(fid);
    }
  }
  return out;
}

const warnedSets = new WeakMap<GameState, Set<string>>();

/** Uncovered flights departing within 48 h: one message per batch and a crewShortage pause. */
function warnShort(g: GameState, ids: string[]): void {
  let warned = warnedSets.get(g);
  if (!warned) warnedSets.set(g, (warned = new Set()));
  const seen = warned;
  const soon = ids.filter((id) => !seen.has(id) && (g.flights[id]?.std ?? Infinity) < g.now + 2 * DAY);
  if (!soon.length) return;
  for (const id of soon) seen.add(id);
  const fl = soon.map((id) => g.flights[id]).sort((a, b) => a.std - b.std);
  const f = fl[0];
  pushMessage(g, {
    tone: 'warn', cat: 'crew',
    title: fl.length === 1 ? `No crew for ${f.no}` : `No crew for ${fl.length} flights`,
    body: `${f.no} ${f.from}–${f.to} departs ${fmtDateTime(f.std)}${fl.length > 1 ? ` (and ${fl.length - 1} more)` : ''}. Hire, deadhead or allow tight duties.`,
    ref: { kind: 'flight', id: f.id },
  });
  requestPause('crewShortage');
}

function fillAll(g: GameState, ps: Pairing[], res: RosterResult, exclude?: Set<string>): void {
  if (!ps.length) return;
  crewIx(g);
  const ctx = new Ctx(g);
  for (const p of ps) if (g.pairings[p.id]) fillPairing(g, ctx, p, res, exclude);
  touchCrew(g);
}

/**
 * Greedy auto-roster: rebuild open pairings of the aircraft, then fill every open slot of pairings starting in
 * [from, to) (default: now → roster horizon; a tour is filled as a whole) with the best-scoring legal crew
 * member; tickets position crew (one per group).
 */
export function autoRoster(g: GameState, opts: { from?: Minute; to?: Minute; aircraftIds?: string[] } = {}): RosterResult {
  const res = emptyResult();
  const from = Math.max(opts.from ?? g.now, g.now);
  const to = opts.to ?? g.now + BAL.rosterHorizonDays * DAY;
  const acs = opts.aircraftIds ?? Object.keys(g.fleet);
  for (const id of acs) planAircraft(g, id, from);
  const sel = new Set(acs);
  const open = Object.values(g.pairings)
    .filter((p) => p.aircraftId && sel.has(p.aircraftId) && (p.status === 'planned' || p.status === 'active') && p.start < to && p.end > from && p.slots.some((s) => !s.crewId))
    .sort((a, b) => a.start - b.start || (a.id < b.id ? -1 : 1));
  fillAll(g, open, res);
  res.uncovered = uncoveredOf(g, open, from, to);
  warnShort(g, res.uncovered);
  return res;
}

// ---------- change sync ----------

const inHorizon = (g: GameState, t: Minute) => t < g.now + BAL.rosterHorizonDays * DAY;

/**
 * Cheap re-sync after another module changed an aircraft's flights from t (retime, cancel, removal, reassign,
 * sub-charter); called from crew's settle hook. Drops foreign flights from duties, re-measures changed duties
 * (ev++, re-queued), re-checks crew; illegal or uncovered work inside the roster horizon goes through rerosterFrom.
 */
export function onFlightsChanged(g: GameState, aircraftId: string, t: Minute): void {
  let reroster = false;
  let changed = false;
  for (const p of [...(crewIx(g).byAircraft.get(aircraftId) ?? [])]) {
    if (p.status === 'done' || p.status === 'broken' || p.end < t - DAY || !g.pairings[p.id]) continue;
    let pChanged = false;
    for (const did of [...p.dutyIds]) {
      const d = g.duties[did];
      if (!d || d.done) continue;
      const keep: string[] = [];
      let ev = 0;
      for (const fid of d.flightIds) {
        const f = g.flights[fid];
        if (f && f.status !== 'cancelled' && f.aircraftId === aircraftId) {
          keep.push(fid);
          ev += f.ev;
        } else if (f && f.dutyId === d.id) {
          f.dutyId = null;
          if (f.status === 'scheduled' || f.status === 'cancelled') f.crewIds = [];
        }
      }
      if (keep.length === d.flightIds.length && ev === d.flightsEv) continue;
      pChanged = true;
      if (!keep.length) {
        detachDuty(g, p, d);
        continue;
      }
      d.flightIds = keep;
      syncDuty(g, d, p);
      if (crewCount(p) > 0) queueDuty(g, d);
    }
    if (!pChanged) continue;
    changed = true;
    if (!p.dutyIds.length) {
      dissolve(g, p);
      continue;
    }
    for (const id of refreshPairing(g, p)) releaseCrew(g, p, id);
    setFlightsCrew(g, p);
    touchCrew(g);
    if (crewCount(p) > 0 && recheckPairing(g, p).level === 'illegal' && inHorizon(g, p.start)) reroster = true;
    if (p.slots.some((s) => !s.crewId) && inHorizon(g, p.start)) reroster = true;
  }
  touchCrew(g);
  // Flights new to this aircraft (or dropped from a duty) still to fly.
  const own = new Set<string>();
  for (const p of crewIx(g).byAircraft.get(aircraftId) ?? []) for (const did of p.dutyIds) for (const fid of g.duties[did]?.flightIds ?? []) own.add(fid);
  const free = flightsOf(g, aircraftId).some((f) => f.status === 'scheduled' && f.aircraftId === aircraftId && f.std >= g.now && !own.has(f.id));
  if (!reroster && !free && !changed) return;
  if (g.company.policies.autoRoster && (reroster || free)) rerosterFrom(g, aircraftId, Math.max(g.now, t));
  else if (free) planAircraft(g, aircraftId, g.now);
}

/**
 * Re-plans an aircraft from t: duties that broke their FDP limit are re-cut (tours and single-duty trips),
 * crew who became illegal are freed, then the auto-roster refills (crew already at the station score best).
 */
export function rerosterFrom(g: GameState, aircraftId: string, t: Minute): RosterResult {
  for (const p of [...(crewIx(g).byAircraft.get(aircraftId) ?? [])]) {
    if (!g.pairings[p.id] || p.status === 'done' || p.status === 'broken' || p.end < t) continue;
    if (p.tour || p.dutyIds.length === 1) {
      for (const d of openDuties(g, p)) {
        if (d.legality === 'illegal' && d.report > g.now && d.report >= t && !d.discretion) detachDuty(g, p, d);
      }
      if (!p.dutyIds.length) {
        dissolve(g, p);
        continue;
      }
      if (!openDuties(g, p).length) continue;
      for (const id of refreshPairing(g, p)) releaseCrew(g, p, id);
    }
    if (crewCount(p) === 0) continue;
    const firstOpen = openDuties(g, p)[0];
    if (!firstOpen || (firstOpen.report <= g.now && !p.tour)) {
      recheckPairing(g, p);
      continue;
    }
    for (const id of recheckPairing(g, p, true).illegal) releaseCrew(g, p, id);
    setFlightsCrew(g, p);
  }
  touchCrew(g);
  const res = autoRoster(g, { from: t, aircraftIds: [aircraftId] });
  for (const p of crewIx(g).byAircraft.get(aircraftId) ?? []) if (p.status !== 'done' && p.end >= t && crewCount(p) > 0) recheckPairing(g, p);
  return res;
}

// Crewed tours accept a new duty only if every crew member stays legal.
setCrewOkHook((g, p, d) => {
  for (const s of p.slots) {
    if (!s.crewId) continue;
    const c = g.crew[s.crewId];
    if (!c) continue;
    const segs = mergeSegs(segsOf(g, c), dutySegs(g, c, p, d, null, null, true));
    if (evalSegs(ctxOf(g, c), segs).some((i) => i.level === 'illegal' && i.code !== 'fdp')) return false;
  }
  return true;
});

// ---------- disruption APIs ----------

/** Commander's discretion (B3 crewShort decision): maxFdp +2:00 (+3:00 augmented), crew.discretion++, morale −3. */
export function applyDiscretion(g: GameState, dutyId: string): ActionResult {
  const d = g.duties[dutyId];
  const p = d && g.pairings[d.pairingId];
  if (!d || !p) return { ok: false, error: 'Duty not found' };
  if (d.done) return { ok: false, error: 'Duty already flown' };
  if (d.discretion) return { ok: false, error: 'Discretion already used on this duty' };
  d.discretion = d.augment > 0 ? 180 : 120;
  d.legality = dutyLegality(d);
  for (const s of p.slots) {
    const c = s.crewId ? g.crew[s.crewId] : undefined;
    if (!c) continue;
    c.discretion++;
    c.morale = Math.max(0, c.morale - 3);
    c.fatigue = Math.min(100, c.fatigue + 10);
  }
  if (p.slots.some((s) => !s.crewId)) fillAll(g, [p], emptyResult());
  recheckPairing(g, p);
  touchCrew(g);
  const lim = d.maxFdp + d.discretion;
  return { ok: true, msg: d.legality === 'illegal' ? 'Discretion is not enough for this duty' : `Commander's discretion: FDP limit ${Math.floor(lim / 60)}:${String(lim % 60).padStart(2, '0')}` };
}

/** Replaces one slot's crew member: the given one, or the best legal candidate (deadhead included). */
export function replaceCrew(g: GameState, pairingId: string, slot: number, crewId?: string): ActionResult<{ crewId: string }> {
  const p = g.pairings[pairingId];
  if (!p || !p.slots[slot]) return { ok: false, error: 'Slot not found' };
  if (crewId) {
    const r = assignCrew(g, pairingId, slot, crewId);
    return r.ok ? { ok: true, msg: r.msg, data: { crewId } } : r;
  }
  const cur = p.slots[slot].crewId;
  if (cur) releaseCrew(g, p, cur);
  fillAll(g, [p], emptyResult(), cur ? new Set([cur]) : undefined);
  const now = p.slots[slot].crewId;
  recheckPairing(g, p);
  touchCrew(g);
  if (!now) return { ok: false, error: 'No legal crew member can reach this duty' };
  const c = g.crew[now];
  return { ok: true, msg: `${c.first} ${c.last} takes the ${p.slots[slot].role} seat`, data: { crewId: now } };
}

/** Takes a crew member off every slot overlapping [from, to) (sickness, leave) and re-rosters those pairings. */
export function removeCrew(g: GameState, crewId: string, from: Minute, to: Minute): RosterResult {
  const res = emptyResult();
  const c = g.crew[crewId];
  if (!c) return res;
  c.blocks ??= [];
  if (!c.blocks.some((b) => b.from <= from && b.to >= to)) c.blocks.push({ from, to, why: 'leave' });
  const hit = (crewIx(g).pairingsOf.get(crewId) ?? []).filter((p) => p.status !== 'done' && p.status !== 'broken' && p.start < to && p.end > from);
  for (const p of hit) releaseCrew(g, p, crewId);
  if (c.loc !== c.base) sendHome(g, c, hit[0]);
  fillAll(g, hit, res, new Set([crewId]));
  for (const p of hit) if (g.pairings[p.id]) recheckPairing(g, p);
  res.uncovered = uncoveredOf(g, hit, g.now, Infinity);
  return res;
}

/** Manual override from the roster view (illegal assignments are allowed but flagged red). */
export function assignCrew(g: GameState, pairingId: string, slot: number, crewId: string): ActionResult {
  const p = g.pairings[pairingId];
  const c = g.crew[crewId];
  if (!p || !p.slots[slot]) return { ok: false, error: 'Slot not found' };
  if (!c) return { ok: false, error: 'Crew member not found' };
  const role = p.slots[slot].role;
  const t = typeOf(typeIdOf(g, p));
  if (!canFill(role, c.role)) return { ok: false, error: `A ${c.role} can't fill a ${role} seat` };
  if (!c.ratings.includes(t.family)) return { ok: false, error: `Not rated on ${t.short}` };
  if (p.slots.some((s) => s.crewId === crewId)) return { ok: false, error: 'Already on this trip' };
  if (!openDuties(g, p).length) return { ok: false, error: 'Trip already flown' };
  const cur = p.slots[slot].crewId;
  if (cur) releaseCrew(g, p, cur);
  const hadCrew = crewCount(p) > 0;
  const plan = planCrew(g, c, p, segsOf(g, c));
  p.slots[slot].crewId = c.id;
  buyTickets(g, p, new Map([[c.id, plan]]), emptyResult());
  setFlightsCrew(g, p);
  if (!hadCrew) for (const d of openDuties(g, p)) queueDuty(g, d);
  touchCrew(g);
  recheckPairing(g, p);
  const bad = plan.issues.filter((i) => i.level === 'illegal');
  return { ok: true, msg: bad.length ? `Assigned, but illegal: ${bad[0].text}` : `${c.first} ${c.last} assigned` };
}

export function unassignCrew(g: GameState, pairingId: string, slot: number): ActionResult {
  const p = g.pairings[pairingId];
  if (!p || !p.slots[slot]) return { ok: false, error: 'Slot not found' };
  const cur = p.slots[slot].crewId;
  if (!cur) return { ok: false, error: 'Slot is already empty' };
  releaseCrew(g, p, cur);
  recheckPairing(g, p);
  touchCrew(g);
  return { ok: true };
}

// ---------- read APIs ----------

/** A crew member's duties overlapping [from, to), in time order. */
export function rosterOf(g: GameState, crewId: string, from: Minute, to: Minute): Duty[] {
  const out: Duty[] = [];
  for (const p of crewIx(g).pairingsOf.get(crewId) ?? []) {
    if (p.end < from || p.start >= to) continue;
    for (const id of p.dutyIds) {
      const d = g.duties[id];
      if (d && d.release > from && d.report < to) out.push(d);
    }
  }
  return out.sort((a, b) => a.report - b.report);
}

export interface FlightCrewStatus {
  level: 'ok' | 'tight' | 'missing' | 'illegal';
  missing: Role[];
}

/** Crew coverage of a flight (Schedule and map panels colour by this). */
export function flightCrewStatus(g: GameState, flightId: string): FlightCrewStatus {
  const f = g.flights[flightId];
  if (!f || !f.aircraftId || f.kind === 'deadhead' || f.status === 'cancelled') return { level: 'ok', missing: [] };
  const d = f.dutyId ? g.duties[f.dutyId] : undefined;
  const p = d ? g.pairings[d.pairingId] : undefined;
  if (!d || !p) {
    if (f.status !== 'scheduled') return { level: 'ok', missing: [] };
    const ac = g.fleet[f.aircraftId];
    return { level: 'missing', missing: ac ? complement(ac.typeId, ac.cabin.total, { extraCabin: g.company.policies.extraCabin }) : [] };
  }
  const missing = p.slots.filter((s) => !s.crewId).map((s) => s.role);
  if (d.legality === 'illegal') return { level: 'illegal', missing };
  if (missing.length) return { level: 'missing', missing };
  if (p.legality === 'illegal') return { level: 'illegal', missing };
  return { level: d.legality === 'tight' || p.legality === 'tight' ? 'tight' : 'ok', missing };
}
