// v0.19.4 work tailored to the fleet: clients "see which aircraft we have available". Every aircraft of ours counts
// (in service, or delivering for work that starts after its handover), weighted up when it sits idle or comes free
// soon: an idle widebody brings widebody calls, an idle A321 a 220-seat job. The market, the leads and the tenders read
// the widebody share and a target aircraft from here (offers.ts generateOffer, commercial/sales.ts, tenders.ts).
//
// The occasional out-of-reach job (the "taste of progression": a client asking for a double-decker) is rationed here
// too: one at most every BAL.v0194.reach.days (offers.ts reachLoad marks it), and only once our prestige level reaches
// BAL.v0194.reach.minLevel (the charter market: a brochure-work newcomer is not where a double-decker job calls).

import { ACMI_TYPES_LIST } from '../../data/acmiTypes';
import { AIRLINE_FAMILIES } from '../../data/naming';
import { BAL } from '../core/balance';
import { typeOf } from '../core/perf';
import { DAY } from '../core/time';
import type { Aircraft, Client, GameState, Minute, Requirements } from '../core/types';
import { bodyOfReq } from './shape';
import { anchorsOf } from './plan';
import { playerLevel, playerPrestige, PRESTIGE_GATE } from './prestige';

export interface FleetUnit {
  id: string;
  typeId: string;
  body: 'narrow' | 'wide';
  seats: number;
  /** In service from (now, or the handover of an aircraft still delivering). */
  from: Minute;
  /** Share of the next `idleDays` with nothing booked (0–1). */
  idle: number;
  /** Weight in the offer mix: 1 (in service; a delivery inside the horizon), more when idle. */
  w: number;
}

export interface FleetOutlook {
  units: FleetUnit[];
  /** Weighted widebody share of the work clients ask us for (0 with no widebody in the fleet or delivering). */
  wideShare: number;
  anyWide: boolean;
  /** Our biggest cabin (seats) and whether a 400-seat (double-decker class) aircraft is ours. */
  maxSeats: number;
  jumbo: boolean;
}

const R = () => BAL.v0194.fleet;

/** Whether an aircraft is ours to offer (not leased out, stored or sold). Pure. */
export const offerable = (a: Aircraft): boolean => a.status !== 'leasedOut' && a.status !== 'stored' && !a.sale;

/** When a delivering aircraft can start work (its handover, plus a few days to ferry and induct). Pure. */
export function availableFrom(g: GameState, a: Aircraft): Minute {
  if (a.status !== 'delivering') return g.now;
  return Math.max(g.now, (a.delivery?.handover ?? g.now) + R().deliveryDays * DAY);
}

/** Share of [from, from + days] with nothing booked on the aircraft (its anchors: legs, checks, base tails). Pure. */
function idleShare(g: GameState, a: Aircraft, from: Minute, days: number): number {
  const to = from + days * DAY;
  let busy = 0;
  for (const n of anchorsOf(g, a.id)) {
    if (n.kind === 'start') continue;
    const s = Math.max(from, n.std);
    const e = Math.min(to, n.sta);
    if (e > s) busy += e - s;
  }
  return Math.max(0, Math.min(1, 1 - busy / (to - from)));
}

const cache = new WeakMap<GameState, { key: string; v: FleetOutlook }>();

/** The fleet as clients see it (cached per hour and fleet / contract count). Pure. */
export function fleetOutlook(g: GameState): FleetOutlook {
  const key = `${Math.floor(g.now / 60)}:${Object.keys(g.fleet).length}:${Object.keys(g.contracts).length}:${Object.keys(g.maintenance).length}`;
  const c = cache.get(g);
  if (c && c.key === key) return c.v;
  const P = R();
  const units: FleetUnit[] = [];
  for (const a of Object.values(g.fleet)) {
    if (!offerable(a)) continue;
    const from = availableFrom(g, a);
    if (from > g.now + P.horizonDays * DAY) continue;
    const idle = idleShare(g, a, from, P.idleDays);
    const t = typeOf(a.typeId);
    units.push({ id: a.id, typeId: a.typeId, body: t.body === 'wide' ? 'wide' : 'narrow', seats: a.cabin.total, from, idle, w: 1 + P.idleWeight * idle });
  }
  const all = units.reduce((s, u) => s + u.w, 0);
  const wide = units.filter((u) => u.body === 'wide').reduce((s, u) => s + u.w, 0);
  const anyWide = units.some((u) => u.body === 'wide');
  const v: FleetOutlook = {
    units,
    wideShare: all > 0 ? wide / all : 0,
    anyWide,
    maxSeats: Math.max(0, ...units.map((u) => u.seats)),
    jumbo: units.some((u) => u.seats >= BAL.v09.jumbo.pax[0]),
  };
  cache.set(g, { key, v });
  return v;
}

/** The widebody share the market draws with: the weighted fleet share. Pure. */
export const wideShareOf = (g: GameState): number => fleetOutlook(g).wideShare;

/** A widebody in the fleet, delivering or bought (status aside). Pure. */
export const holdsWide = (g: GameState): boolean => Object.values(g.fleet).some((a) => offerable(a) && typeOf(a.typeId).body === 'wide');

/**
 * The aircraft a client has in mind for a job of that body (weighted by idleness; a delivering one only for work that
 * starts after it arrives), from a draw in [0, 1). Undefined when none. Pure.
 */
export function targetUnit(g: GameState, body: 'narrow' | 'wide', roll: number, startAfter?: Minute): FleetUnit | undefined {
  const xs = fleetOutlook(g).units.filter((u) => u.body === body && (startAfter === undefined || u.from <= startAfter));
  const total = xs.reduce((s, u) => s + u.w, 0);
  if (!xs.length || total <= 0) return undefined;
  let r = roll * total;
  for (const u of xs) {
    r -= u.w;
    if (r < 0) return u;
  }
  return xs[xs.length - 1];
}

/** Seats a client asks for when it has our aircraft in mind: its cabin, a little under, in tens. Pure. */
export const seatsFor = (u: FleetUnit, roll: number): number => Math.max(100, Math.floor((u.seats * (1 - R().seatsUnder * roll)) / 10) * 10);

// ---------- the out-of-reach job (a taste of progression) ----------

/**
 * One out-of-reach job at most every BAL.v0194.reach.days, and none below prestige level BAL.v0194.reach.minLevel (the
 * ladder's market effects, as the stretch offers: off under vitest unless a suite switches PRESTIGE_GATE on). Pure.
 */
export function reachOpen(g: GameState): boolean {
  if (PRESTIGE_GATE.on && playerLevel(g) < BAL.v0194.reach.minLevel) return false;
  const at = g.company.prestige?.reachAt;
  return at === undefined || g.now - at >= BAL.v0194.reach.days * DAY;
}

/** An out-of-reach job reached the market: the next waits. Action-side. */
export function noteReach(g: GameState): void {
  playerPrestige(g).reachAt = g.now;
}

// ---------- the body a client asks us for ----------

const WIDE_FAMS = new Set(ACMI_TYPES_LIST.filter((t) => t.body === 'wide').map((t) => t.family as string));
const NARROW_FAMS = new Set(ACMI_TYPES_LIST.filter((t) => t.body === 'narrow').map((t) => t.family as string));

/**
 * The bodies a client could use from us: an airline by the families it flies (crew, slots, stands, its passengers'
 * expectations), anyone else either. An airline that flies none of our families (airBaltic's A220s, Airlink's
 * Embraers) wet-leases narrowbodies to fill in, never a widebody. A widebody-only airline (Iberojet, World2fly,
 * Corsair, French bee, Norse) never asks for a narrowbody. Pure.
 */
export function clientBodies(c: Pick<Client, 'name' | 'kind'>): { narrow: boolean; wide: boolean } {
  const fams = c.kind === 'airline' ? AIRLINE_FAMILIES[c.name] : undefined;
  if (!fams) return { narrow: true, wide: true };
  const narrow = fams.some((f) => NARROW_FAMS.has(f));
  const wide = fams.some((f) => WIDE_FAMS.has(f));
  return narrow || wide ? { narrow, wide } : { narrow: true, wide: false };
}

/** Whether the client would ask for a job of this body (clientBodies). Pure. */
export const clientTakes = (c: Pick<Client, 'name' | 'kind'>, body: 'narrow' | 'wide'): boolean => clientBodies(c)[body];

/**
 * Whether a client would ask for this job: an airline the body it flies (clientBodies) and, when the job names
 * families, one of its own (crew commonality; an airline with no family of ours named takes any). Anyone else: yes. Pure.
 */
export function clientFlies(c: Pick<Client, 'name' | 'kind'>, req: Pick<Requirements, 'minSeats' | 'body' | 'families'>): boolean {
  if (c.kind !== 'airline') return true;
  if (!clientTakes(c, bodyOfReq(req))) return false;
  const fams = AIRLINE_FAMILIES[c.name];
  return !req.families?.length || !fams?.length || req.families.some((f) => fams.includes(f));
}

/**
 * The bodies we could offer a client: what we have (in service or delivering) and what it flies; a fleet without a
 * widebody offers narrowbodies only (the newcomer rules). Narrowbody first. Empty when nothing of ours suits it (a
 * widebody-only airline and a narrowbody fleet): no lead, no pitch. Pure.
 */
export function bodiesFor(g: GameState, c: Pick<Client, 'name' | 'kind'>): ('narrow' | 'wide')[] {
  const cb = clientBodies(c);
  const units = fleetOutlook(g).units;
  const out: ('narrow' | 'wide')[] = [];
  if (cb.narrow && units.some((u) => u.body === 'narrow')) out.push('narrow');
  if (cb.wide && holdsWide(g)) out.push('wide');
  // A company with no aircraft at all (a scenario's opening, a test) still talks narrowbodies to whoever flies them.
  if (!out.length && !units.length && cb.narrow) out.push('narrow');
  return out;
}

/** The body a client asks for, from a draw in [0, 1): our weighted widebody share among the bodies it could use;
 *  undefined when none suits it (bodiesFor). Pure. */
export function pickBody(g: GameState, c: Pick<Client, 'name' | 'kind'>, roll: number): 'narrow' | 'wide' | undefined {
  const b = bodiesFor(g, c);
  if (b.length <= 1) return b[0];
  return roll < fleetOutlook(g).wideShare ? 'wide' : 'narrow';
}
