// v0.7.3 in-flight rest (UPDATE-0.7.3.md §2.1–§2.5; CS FTL.1.205(c)): the pilots' and cabin crew's facilities per
// airframe (migrated from the v0.7.2 {bunks, seats}), the deterministic rest plan of a duty (who rests when, where
// and for how long), the "longest day" an airframe allows and the plain-language rest lines. Pure.

import { ACMI_TYPES } from '../../data/acmiTypes';
import { BAL } from '../core/balance';
import { cabinMinimum } from '../core/perf';
import { fmtDuration } from '../core/time';
import { markFlightsChanged } from '../core/entities';
import { pushMessage } from '../core/messages';
import type { AcRest, Aircraft, AircraftOffer, Duty, Flight, GameState, Minute, Pairing, RestFacility, RestKind } from '../core/types';
import { hash } from '../core/util';
import { range, type RngHolder } from '../core/rng';
import { augLimitOf, cabinFdpCap, cabinInflightRest } from './rules';
import { dutyNeed } from './duties';
import { crewIx } from './timeline';

const H = 60;
const NONE: AcRest = { fc: null, cc: null };

// ---------- facilities ----------

const fcrc = (): RestFacility => ({ cls: 1, kind: 'fcrc', places: 2 });
/** The type's cabin crew bunks (class 1); a type without its own count gets ⌈typical cabin crew / 2⌉ bunks. */
const ccrcOf = (typeId: string): RestFacility | null => {
  const t = ACMI_TYPES[typeId];
  if (!t) return null;
  return { cls: 1, kind: t.rest.ccrcKind, places: t.rest.ccrcPlaces || Math.max(2, Math.ceil(t.cabinTypical / 2)) };
};
/** v0.7.4 crew bunks always come as a pair: pilots' compartment and cabin crew compartment (class 1 both). */
export const bunksFor = (typeId: string): AcRest => ({ fc: fcrc(), cc: ccrcOf(typeId) });

/** Curtained business seats for one side (pilots 2; cabin crew min(J − 2, ⌈typical / 2⌉)); null without J ≥ 4. */
export function jSeatsFor(typeId: string, j: number, side: 'fc' | 'cc'): RestFacility | null {
  const t = ACMI_TYPES[typeId];
  if (!t || j < 4) return null;
  const places = side === 'fc' ? 2 : Math.max(1, Math.min(j - 2, Math.ceil(t.cabinTypical / 2)));
  return { cls: t.rest.jClass, kind: 'jSeats', places };
}

/** v0.7.4 curtained economy seats for one side (class 3): pilots 2, cabin crew ⌈typical / 2⌉. Every aircraft has them. */
export function ySeatsFor(typeId: string, side: 'fc' | 'cc'): RestFacility | null {
  const t = ACMI_TYPES[typeId];
  if (!t) return null;
  return { cls: 3, kind: 'ySeats', places: side === 'fc' ? 2 : Math.max(1, Math.ceil(t.cabinTypical / 2)) };
}

/**
 * v0.7.4 the seat rest every aircraft has from its CURRENT cabin (not a fitted facility, no capacity lost: the seats
 * are blocked only on legs where someone rests in them): curtained business seats (class 2) when the cabin has 4+
 * business seats, else curtained economy seats (class 3). Pure.
 */
export function seatRest(typeId: string, cabin: { j: number }): AcRest {
  return { fc: jSeatsFor(typeId, cabin.j, 'fc') ?? ySeatsFor(typeId, 'fc'), cc: jSeatsFor(typeId, cabin.j, 'cc') ?? ySeatsFor(typeId, 'cc') };
}

/** The better of two facilities for one side (lower class); a fitted one wins a tie (it costs no seats in sale). */
const better = (fitted: RestFacility | null, seats: RestFacility | null): RestFacility | null => (!fitted ? seats : !seats || fitted.cls <= seats.cls ? fitted : seats);

/**
 * v0.7.4 what the crew can actually rest in: per side the better of the fitted facility (bunks, recliners) and the
 * curtained seats of the current cabin. Every aircraft has rest for both crews (at worst class 3). Pure.
 */
export function effectiveRest(typeId: string, cabin: { j: number }, fitted: AcRest): AcRest {
  if (!ACMI_TYPES[typeId]) return fitted;
  const s = seatRest(typeId, cabin);
  return { fc: better(fitted.fc, s.fc), cc: better(fitted.cc, s.cc) };
}

/**
 * v0.7.4 the fitted facilities in today's model (idempotent): seat entries dropped (they follow the cabin now),
 * crew rest recliners class 2, and bunks paired: pilot bunks without cabin crew bunks get the type's cabin crew
 * bunks, and the reverse. `noBunks` (a 767 the game gave bunks) drops both. Pure.
 */
export function fittedRest(typeId: string, r: AcRest, noBunks = false): AcRest {
  const keep = (f: RestFacility | null): RestFacility | null => (!f || f.kind === 'jSeats' || f.kind === 'ySeats' ? null : f.kind === 'recliners' ? { ...f, cls: 2 } : { ...f });
  let fc = keep(r.fc);
  let cc = keep(r.cc);
  if (noBunks) {
    if (fc?.cls === 1) fc = null;
    if (cc?.cls === 1) cc = null;
  }
  if (fc?.cls === 1 && cc?.cls !== 1) cc = ccrcOf(typeId);
  if (cc?.cls === 1 && fc?.cls !== 1) fc = fcrc();
  return { fc, cc };
}

/**
 * v0.7.3 the v0.7.2 crew rest of an airframe or offer in the new model (UPDATE-0.7.3.md §2.1 migration table):
 * bunks → the type's compartments (v0.7.4: both, paired); rest seats → crew rest recliners; nothing recorded (older
 * saves, start fleet) → bunks on a type whose standard is bunks. v0.7.4: the FITTED facilities only (seats follow
 * the cabin: effectiveRest). Idempotent (returns `rest` when already set). Pure.
 */
export function migrateRest(x: Pick<Aircraft, 'typeId' | 'cabin' | 'crewRest' | 'rest'> | Pick<AircraftOffer, 'typeId' | 'cabin' | 'crewRest' | 'rest'>): AcRest {
  if (x.rest) return x.rest;
  const t = ACMI_TYPES[x.typeId];
  if (!t) return { ...NONE };
  const old = x.crewRest ?? { bunks: t.body === 'wide' && t.restClass === 1, seats: 0 };
  // (A 767 the game gave bunks keeps them here; the v0.7.4 load takes them off with a message: loadRest074.)
  if (old.bunks) return bunksFor(x.typeId);
  if (old.seats > 0) return { fc: { cls: 2, kind: 'recliners', places: Math.min(2, old.seats) }, cc: { cls: 2, kind: 'recliners', places: Math.max(1, old.seats - 2) } };
  return { ...NONE };
}

/** v0.7.4 an airframe's or offer's rest as the crew use it (fitted + the seats of its cabin). Pure. */
export const restOfAc = (x: Pick<Aircraft, 'typeId' | 'cabin' | 'crewRest' | 'rest'> | Pick<AircraftOffer, 'typeId' | 'cabin' | 'crewRest' | 'rest'>): AcRest =>
  effectiveRest(x.typeId, x.cabin, migrateRest(x));

/**
 * v0.7.3 market roll of an airframe's FITTED facilities (`u()` gives uniform numbers in [0, 1)). v0.7.4: ONE roll for
 * crew bunks, always both kinds (pilots and cabin crew); the 767 never. Three draws kept so the market stream stays
 * as before. Pure.
 */
export function rollRest(typeId: string, _j: number, u: () => number): AcRest {
  const t = ACMI_TYPES[typeId];
  if (!t || t.body !== 'wide') return { ...NONE };
  const a = u();
  u();
  u();
  const share = t.rest.bunkShare;
  return share >= 1 || (share > 0 && a < share) ? bunksFor(typeId) : { ...NONE };
}

/** v0.7.3 the start fleet / dev fleet roll: deterministic from the aircraft id (widebodies only). Pure. */
export function rollRestFor(id: string, typeId: string, j: number): AcRest {
  const h: RngHolder = { rng: hash(`${id}:rest`) | 0 };
  return rollRest(typeId, j, () => range(h, 0, 1));
}

/**
 * v0.7.3 load: facilities for every airframe and open offer (`??= migrateRest`). When an airframe had none (a
 * pre-v0.7.3 save), a crewed trip that has started or reports within 72 h keeps its augmentation on every duty
 * still to fly without the rest-plan check (`legacyRest`, per pairing so a return leg is never stranded); every
 * other duty on a migrated airframe is re-measured at the first settle (onFlightsChanged) under the new rules.
 */
export function loadRest(g: GameState): void {
  const migrated = new Set<string>();
  for (const ac of Object.values(g.fleet)) {
    if (ac.rest) continue;
    ac.rest = migrateRest(ac);
    migrated.add(ac.id);
  }
  for (const o of g.market?.aircraft ?? []) o.rest ??= migrateRest(o);
  if (!migrated.size) return;
  for (const p of Object.values(g.pairings)) {
    const open = p.dutyIds.map((id) => g.duties[id]).filter((d): d is Duty => !!d && !d.done);
    if (!open.length) continue;
    const crewed = p.slots.some((s) => s.crewId);
    const soon = p.status === 'active' || open.some((d) => d.report <= g.now + 72 * H);
    if (crewed && soon) {
      for (const d of open) d.legacyRest = true;
      continue;
    }
    if (!p.aircraftId || !migrated.has(p.aircraftId)) continue;
    // Stale v0.7.2 measures: forced out of date so the crew settle re-plans them (pickPlan with the facilities).
    for (const d of open) {
      if (d.report <= g.now) continue;
      d.flightsEv = -1;
      markFlightsChanged(g, p.aircraftId, Math.min(d.report, g.flights[d.flightIds[0]]?.std ?? d.report));
    }
  }
}

/**
 * v0.7.4 load (idempotent, ??= style): every airframe's facilities into the v0.7.4 model once (`restV` 2): seat
 * entries dropped (the seats of the current cabin are always there), recliners class 2, bunks paired, and the bunks
 * the game gave a 767-300ER taken off (the type never has them; bunks the player fitted stay). When the crew's rest
 * got worse on a side (only those 767s), every open augmented duty on it is checked again: a trip already under way
 * keeps its crew as rostered (`legacyRest`), the rest are re-planned at the first settle; one inbox message each.
 * Open market offers are normalised too. Returns the aircraft ids whose rest got worse.
 */
export function loadRest074(g: GameState): string[] {
  for (const o of g.market?.aircraft ?? []) if (o.rest) o.rest = fittedRest(o.typeId, o.rest, (ACMI_TYPES[o.typeId]?.rest.bunkShare ?? 1) === 0);
  const out: string[] = [];
  for (const ac of Object.values(g.fleet)) {
    if (ac.restV === 2) continue;
    const t = ACMI_TYPES[ac.typeId];
    const old = ac.rest ?? migrateRest(ac);
    const fitted = Object.values(g.maintenance).some((m) => m.aircraftId === ac.id && m.status === 'done' && (m.restFit === 'fcrc' || m.restFit === 'ldmcr' || m.restFit === 'overhead'));
    const noBunks = !!t && t.rest.bunkShare === 0 && !t.rest.mro && !fitted;
    ac.rest = fittedRest(ac.typeId, old, noBunks);
    ac.restV = 2;
    const now = restOfAc(ac);
    const worse = (a: RestFacility | null, b: RestFacility | null) => (b?.cls ?? 9) > (a?.cls ?? 9);
    if (!worse(old.fc, now.fc) && !worse(old.cc, now.cc)) continue;
    out.push(ac.id);
    let kept = 0;
    let replanned = 0;
    for (const p of Object.values(g.pairings)) {
      if (p.aircraftId !== ac.id) continue;
      const open = p.dutyIds.map((id) => g.duties[id]).filter((d): d is Duty => !!d && !d.done && d.augment > 0);
      if (!open.length) continue;
      if (p.status === 'active') {
        for (const d of open) d.legacyRest = true;
        kept += open.length;
        continue;
      }
      for (const d of open) {
        d.flightsEv = -1;
        markFlightsChanged(g, ac.id, Math.min(d.report, g.flights[d.flightIds[0]]?.std ?? d.report));
        replanned++;
      }
    }
    const lostBunks = old.fc?.cls === 1 && now.fc?.cls !== 1;
    const dut = (n: number) => `${n} long dut${n === 1 ? 'y' : 'ies'}`;
    pushMessage(g, {
      tone: replanned ? 'warn' : 'info', cat: 'crew',
      title: lostBunks ? `${ac.reg}: no crew bunks (${t?.short ?? ac.typeId})` : `${ac.reg}: crew rest changed`,
      body: `${lostBunks ? `The ${t?.name ?? 'type'} never has crew bunks, so ${ac.reg} no longer shows them. ` : ''}Pilots rest in ${restText(now.fc, 'fc', ac.typeId)}; cabin crew in ${restText(now.cc, 'cc', ac.typeId)}.${replanned ? ` ${dut(replanned)} planned for bunks ${replanned === 1 ? 'is' : 'are'} being re-rostered for this rest (more pilots, or a crew change on the way).` : ''}${kept ? ` ${dut(kept)} of a trip already under way keep${kept === 1 ? 's' : ''} the crew as rostered.` : ''}${!replanned && !kept ? ' No planned duty needed the bunks.' : ''}`,
      ref: { kind: 'aircraft', id: ac.id },
    });
  }
  return out;
}

/**
 * v0.7.3 an airframe's facilities (migrated on the fly when an old record has none); {null, null} when unknown.
 * v0.7.4: as the crew use them: the fitted facilities plus the curtained seats of its current cabin. Pure.
 */
export function restOf(g: GameState, aircraftId: string | null): AcRest {
  const ac = aircraftId ? g.fleet[aircraftId] : undefined;
  if (!ac) return NONE;
  return restOfAc(ac);
}

const KIND_TEXT: Record<RestKind, [string, string]> = {
  fcrc: ['bunks by the cockpit', 'bunk'],
  ccrc: ['overhead bunks', 'bunk'],
  ldmcr: ['lower-deck crew rest module', 'bunk'],
  jSeats: ['business seats, curtained', 'seat'],
  recliners: ['crew rest recliners', 'seat'],
  ySeats: ['economy seats, curtained', 'seat'],
};
/** Short word for where someone rests (timeline labels): 'bunk', 'lower deck', 'business seat', 'recliner'. */
export const restWhere = (k: RestKind): string => (k === 'fcrc' || k === 'ccrc' ? 'bunk' : k === 'ldmcr' ? 'lower deck' : k === 'jSeats' ? 'business seat' : k === 'ySeats' ? 'economy seat' : 'recliner');
/** Plural words for a facility kind: 'bunks', 'lower-deck bunks', 'business seats', 'economy seats', 'recliners'. */
export const restWords = (k: RestKind): string => (k === 'fcrc' || k === 'ccrc' ? 'bunks' : k === 'ldmcr' ? 'lower-deck bunks' : k === 'jSeats' ? 'business seats' : k === 'ySeats' ? 'economy seats' : 'recliners');

/**
 * 'bunks by the cockpit (class 1, 2 bunks)', 'overhead bunks (class 1, 8 bunks)', 'lower-deck bunks (class 1, 14
 * bunks)' (A380), 'lower-deck crew rest module (class 1, 7 bunks)', 'business seats, curtained (class 2, 4 seats)',
 * 'crew rest recliners (class 3, 3 seats)', 'none'. `typeId` only picks the A380's lower-deck words. Pure.
 */
export function restText(f: RestFacility | null, _side: 'fc' | 'cc', typeId?: string): string {
  if (!f) return 'none';
  const [what, unit] = KIND_TEXT[f.kind];
  const name = f.kind === 'ccrc' && typeId === 'a388' ? 'lower-deck bunks' : what;
  return `${name} (class ${f.cls}, ${f.places} ${unit}${f.places === 1 ? '' : 's'})`;
}

/** Short form for chips: 'bunks (class 1)', 'lower-deck module (class 1)', 'business seats (class 2)', 'recliners (class 3)', 'none'. Pure. */
export function restShort(f: RestFacility | null): string {
  if (!f) return 'none';
  const w = f.kind === 'fcrc' || f.kind === 'ccrc' ? 'bunks' : f.kind === 'ldmcr' ? 'lower-deck module' : f.kind === 'jSeats' ? 'business seats' : f.kind === 'ySeats' ? 'economy seats' : 'recliners';
  return `${w} (class ${f.cls})`;
}

export const isSeatRest = (f: RestFacility | null): boolean => !!f && (f.kind === 'jSeats' || f.kind === 'recliners' || f.kind === 'ySeats');
export const hasBunks = (r: AcRest): boolean => r.fc?.cls === 1 || r.cc?.cls === 1;

// ---------- augmented limits (pilots' table capped by the cabin crew's, C2) ----------

/**
 * Max FDP with `augment` extra pilots on these facilities, and the cabin crew's early report for it: the pilots'
 * CS FTL.1.205(c)(2) value (+1:00 on one long sector), and when that plus the type's early report would pass the
 * cabin crew's CS FTL.1.205(c)(3) table for their class, the cabin crew report with the pilots (early 0); only if
 * it still passes is the limit capped. null without a facility for either side. Pure.
 */
export function augLimit(rest: AcRest, augment: 1 | 2, long: boolean, typeEarly: number): { max: number; early: number; capBy: 'pilots' | 'cabin' } | null {
  if (!rest.fc || !rest.cc) return null;
  return augLimitOf(rest.fc.cls, rest.cc.cls, augment, long, typeEarly);
}

// ---------- the rest plan ----------

export interface RestLeg { id: string; std: Minute; sta: Minute }
export type RestSeat = 'CPT' | 'FO' | 'CRP' | 'CPT2' | 'FO2';
export interface RestTurn {
  /** Pilots. */
  seat?: RestSeat;
  /** Cabin crew: group index (A, B, C…). */
  group?: number;
  /** Crew in this turn (1 pilot; a cabin group's size). */
  n: number;
  /** Filled when rostered (pilot by seat; cabin crew in slot order), else []. */
  crewIds: string[];
  flightId: string;
  start: Minute;
  end: Minute;
  /** The legal minimum (90 / 120 / the cabin table). */
  need: number;
  where: RestKind;
  cls: 1 | 2 | 3;
  /** A landing pilot of the last sector. */
  landing?: boolean;
}
export interface RestPlan {
  ok: boolean;
  code: 'ok' | 'noFacility' | 'sectors' | 'tooShort' | 'cabinClass' | 'cabinFit';
  /** Plain words when not ok. */
  why: string | null;
  augment: 1 | 2;
  pilots: RestTurn[];
  cabin: RestTurn[];
  /** Pilots' FDP + this duty's cabin crew early report. */
  cabinFdp: number;
  /** CS FTL.1.205(c)(3) minutes per cabin crew member (null = class not allowed). */
  cabinNeed: number | null;
  /** '15:31–16:00'. */
  band: string | null;
  /** Cabin crew added so everyone can rest. */
  extraCabin: 0 | 1 | 2;
  /** flightId → seats out of sale (seat-based facilities used on that leg). */
  blocked: Record<string, number>;
  /** Smallest slack of any turn (verdict: ≥ 30 OK, < 30 tight). */
  spareMin: number;
  cruise: { flightId: string; from: Minute; to: Minute; cabinFrom: Minute; cabinTo: Minute }[];
  /** Planned before the in-flight rest rules (an older save): kept as rostered, not checked. */
  legacy?: true;
}

const hm = (m: number) => `${Math.floor(Math.max(0, m) / 60)}:${String(Math.round(Math.max(0, m) % 60)).padStart(2, '0')}`;

/** The CS FTL.1.205(c)(3) band of a cabin crew FDP: 'up to 14:30', '15:31–16:00'; null above the table. */
export function cabinBand(fdp: number): string | null {
  if (fdp <= 14 * H + 30) return 'up to 14:30';
  for (let up = 15 * H; up <= 18 * H; up += 30) if (fdp <= up) return `${hm(up - 29)}–${hm(up)}`;
  return null;
}

interface Group { need: number; turns: Omit<RestTurn, 'flightId' | 'start' | 'end'>[] }

/**
 * Places sequential groups (each `need` consecutive minutes) into leg windows from the last leg backwards (the
 * last group ends latest). Returns per group its leg index, or -1 when it fits nowhere.
 */
function placeBackwards(groups: Group[], wins: { a: Minute; b: Minute }[]): number[] {
  const at: number[] = new Array(groups.length).fill(-1);
  let leg = wins.length - 1;
  let cursor = leg >= 0 ? wins[leg].b : 0;
  for (let k = groups.length - 1; k >= 0; k--) {
    while (leg >= 0 && Math.min(cursor, wins[leg].b) - wins[leg].a < groups[k].need) {
      leg--;
      if (leg >= 0) cursor = wins[leg].b;
    }
    if (leg < 0) return at;
    at[k] = leg;
    cursor = Math.min(cursor, wins[leg].b) - groups[k].need;
  }
  return at;
}

/** Packs groups into the longest windows first (as many as fit back to back), in group order. */
function packLongest(groups: Group[], wins: { a: Minute; b: Minute }[]): number[] {
  const at: number[] = new Array(groups.length).fill(-1);
  const order = wins.map((_, i) => i).sort((x, y) => wins[y].b - wins[y].a - (wins[x].b - wins[x].a) || x - y);
  let k = 0;
  for (const i of order) {
    let room = wins[i].b - wins[i].a;
    while (k < groups.length && room >= groups[k].need) {
      at[k] = i;
      room -= groups[k].need;
      k++;
    }
  }
  return at;
}

/**
 * Lays the placed groups out per leg: the leg's spare time shared evenly (rounded down to roundMin), back to back
 * ending at the window end (landing pilots last, GM). Turns get flightId/start/end; returns the smallest share.
 */
function layOut(groups: Group[], at: number[], wins: { a: Minute; b: Minute }[], legs: RestLeg[], out: RestTurn[]): number {
  const R = BAL.v073.rest.roundMin;
  let spare = Infinity;
  for (let i = 0; i < wins.length; i++) {
    const ks = groups.map((_, k) => k).filter((k) => at[k] === i);
    if (!ks.length) continue;
    const used = ks.reduce((s, k) => s + groups[k].need, 0);
    const extra = Math.max(0, Math.floor((wins[i].b - wins[i].a - used) / ks.length / R) * R);
    spare = Math.min(spare, extra);
    let t = wins[i].b;
    const placed: RestTurn[][] = [];
    for (let j = ks.length - 1; j >= 0; j--) {
      const gk = groups[ks[j]];
      const len = gk.need + extra;
      placed.unshift(gk.turns.map((x) => ({ ...x, flightId: legs[i].id, start: t - len, end: t })));
      t -= len;
    }
    for (const p of placed) out.push(...p);
  }
  return spare;
}

/** Pilot rest groups in time order (CS FTL.1.205(c)(1)): relief pilots first (90), the landing pilots last (120). */
function pilotGroups(fc: RestFacility, augment: 1 | 2): Group[] {
  const t = (seat: RestSeat, landing: boolean) => ({ seat, n: 1, crewIds: [] as string[], need: landing ? 120 : 90, where: fc.kind, cls: fc.cls, ...(landing ? { landing: true } : {}) });
  if (augment === 1) return [{ need: 90, turns: [t('CRP', false)] }, { need: 120, turns: [t('FO', true)] }, { need: 120, turns: [t('CPT', true)] }];
  if (Math.min(fc.places, augment) >= 2) return [{ need: 90, turns: [t('CPT2', false), t('FO2', false)] }, { need: 120, turns: [t('CPT', true), t('FO', true)] }];
  return [{ need: 90, turns: [t('CPT2', false)] }, { need: 90, turns: [t('FO2', false)] }, { need: 120, turns: [t('FO', true)] }, { need: 120, turns: [t('CPT', true)] }];
}

function cabinGroups(cc: RestFacility, n: number, need: number): Group[] | null {
  const s = Math.min(cc.places, Math.floor(n / 2));
  if (s < 1) return null;
  const G = Math.ceil(n / s);
  const out: Group[] = [];
  for (let k = 0; k < G; k++) {
    const size = Math.floor(n / G) + (k < n % G ? 1 : 0);
    out.push({ need, turns: [{ group: k, n: size, crewIds: [], need, where: cc.kind, cls: cc.cls }] });
  }
  return out;
}

/**
 * v0.7.3 the in-flight rest plan for these legs (in order), facilities, augmentation, cabin crew FDP and cabin crew
 * count (UPDATE-0.7.3.md §2.2): pilots 90 consecutive minutes each, 120 for the landing pilots, at most 3 sectors,
 * inside the cruise; cabin crew per CS FTL.1.205(c)(3) in groups with half the crew working, none in the first
 * service or the last hour (one or two extra cabin crew when that is what makes it fit); seats blocked only on legs
 * where someone rests in seats. Deterministic. Pure.
 */
export function planRest(legs: RestLeg[], rest: AcRest, augment: 1 | 2, cabinFdp: number, cabinN: number): RestPlan {
  const B = BAL.v073.rest;
  const cruise = legs.map((l) => ({ flightId: l.id, from: l.std + B.tocMin, to: l.sta - B.todMin, cabinFrom: l.std + B.cabinAfterTakeoff, cabinTo: l.sta - B.cabinBeforeLanding }));
  const base: RestPlan = {
    ok: false, code: 'ok', why: null, augment, pilots: [], cabin: [], cabinFdp, cabinNeed: null, band: cabinBand(cabinFdp), extraCabin: 0, blocked: {}, spareMin: 0, cruise,
  };
  const fail = (code: RestPlan['code'], why: string): RestPlan => ({ ...base, code, why });
  if (!legs.length) return fail('tooShort', 'Every leg of this day is cancelled');
  // No cabin crew aboard (a pilots-only ferry): only the pilots rest, no cabin crew cap, no seats out of sale.
  const pilotsOnly = cabinN <= 0;
  if (pilotsOnly) base.band = null;
  if (!rest.fc) return fail('noFacility', 'There is no in-flight rest for the pilots');
  if (!rest.cc && !pilotsOnly) return fail('noFacility', 'There is no in-flight rest for the cabin crew');
  if (legs.length > 3) return fail('sectors', `In-flight rest allows at most 3 sectors; this day has ${legs.length}`);
  // Pilots.
  const pw = legs.map((l) => ({ a: l.std + B.tocMin, b: l.sta - B.todMin - B.wakeMin }));
  const pg = pilotGroups(rest.fc, augment);
  const pat = placeBackwards(pg, pw);
  // The group that found no room first (placed from the last backwards: the landing pilots).
  let miss = -1;
  for (let k = pat.length - 1; k >= 0 && miss < 0; k--) if (pat[k] < 0) miss = k;
  if (miss >= 0) {
    const longest = legs.reduce((m, l) => (l.sta - l.std > m.sta - m.std ? l : m), legs[0]);
    const cr = Math.max(0, longest.sta - longest.std - B.tocMin - B.todMin);
    const landing = pg[miss].need === 120;
    const why = legs.length > 1
      ? `The cruise is too short for in-flight rest (${legs.length} legs, the longest cruise ${hm(cr)}); the ${landing ? 'landing pilots each need 2 hours' : 'pilots each need 90 minutes'} in a row`
      : `The cruise is ${hm(cr)}; the ${landing ? 'landing pilots each need 2 hours' : 'pilots each need 90 minutes'} in a row`;
    return fail('tooShort', why);
  }
  const pilots: RestTurn[] = [];
  let spare = layOut(pg, pat, pw, legs, pilots);
  if (pilotsOnly || !rest.cc) return { ...base, ok: true, code: 'ok', pilots, spareMin: spare === Infinity ? 0 : spare };
  // Cabin crew.
  const need = cabinInflightRest(cabinFdp, rest.cc.cls);
  if (need === null) {
    return { ...fail('cabinClass', `Class ${rest.cc.cls} ${rest.cc.kind === 'recliners' || rest.cc.kind === 'jSeats' || rest.cc.kind === 'ySeats' ? `${restWords(rest.cc.kind)} allow` : 'rest allows'} at most a ${hm(cabinFdpCap(rest.cc.cls))} cabin crew day; this one is ${hm(cabinFdp)}`), pilots };
  }
  const cw = legs.map((l) => ({ a: l.std + B.cabinAfterTakeoff, b: l.sta - B.cabinBeforeLanding }));
  let cabin: RestTurn[] | null = null;
  let extra: 0 | 1 | 2 = 0;
  for (let x = 0; x <= B.maxExtraCabin && !cabin; x++) {
    const groups = cabinGroups(rest.cc, cabinN + x, need);
    if (!groups) continue;
    const at = packLongest(groups, cw);
    if (at.some((i) => i < 0)) continue;
    const turns: RestTurn[] = [];
    spare = Math.min(spare, layOut(groups, at, cw, legs, turns));
    cabin = turns.sort((a, b) => a.start - b.start || (a.group ?? 0) - (b.group ?? 0));
    extra = x as 0 | 1 | 2;
  }
  if (!cabin) {
    const cr = Math.max(0, ...cw.map((w) => w.b - w.a));
    const where = restWords(rest.cc.kind);
    return { ...fail('cabinFit', `${cabinN} cabin crew with ${rest.cc.places} ${where} can't all get ${hm(need)} rest in the ${hm(cr)} of cruise`), pilots, cabinNeed: need };
  }
  // Seats out of sale on legs where someone rests in seats.
  const blocked: Record<string, number> = {};
  for (const l of legs) {
    let n = 0;
    if (isSeatRest(rest.fc) && pilots.some((t) => t.flightId === l.id)) n += rest.fc.places;
    if (isSeatRest(rest.cc) && cabin.some((t) => t.flightId === l.id)) n += rest.cc.places;
    if (n) blocked[l.id] = n;
  }
  return { ...base, ok: true, code: 'ok', pilots, cabin, cabinNeed: need, extraCabin: extra, blocked, spareMin: spare === Infinity ? 0 : spare };
}

// ---------- the plan of a duty ----------

/**
 * A leg for the rest plan: from its actual departure once flying, for its SCHEDULED block (v0.7.4: a few minutes of
 * tailwind don't turn a planned rest into an impossible one; delays move the whole leg).
 */
const legOf = (f: Flight): RestLeg => {
  const std = f.status === 'done' || f.status === 'enroute' ? f.atd ?? f.std : f.std;
  return { id: f.id, std, sta: std + (f.sta - f.std) };
};

/** Operated legs of a duty for the rest plan (cancelled legs and tickets left out). */
export function restLegs(g: GameState, d: Duty): RestLeg[] {
  const out: RestLeg[] = [];
  for (const id of d.flightIds) {
    const f = g.flights[id];
    if (f && f.status !== 'cancelled') out.push(legOf(f));
  }
  return out;
}

/** v0.7.3 a trip of empty legs only (positioning / ferry): it flies with its pilots, no cabin crew aboard. Pure. */
export function pilotsOnlyTrip(g: GameState, p: Pairing): boolean {
  for (const id of p.dutyIds) {
    for (const fid of g.duties[id]?.flightIds ?? []) {
      const k = g.flights[fid]?.kind;
      if (k && k !== 'positioning' && k !== 'ferry') return false;
    }
  }
  return true;
}

/**
 * Cabin crew a duty's rest plan is made for: the legal minimum plus the client's required extra (optional extras
 * ride along); 0 on a pilots-only trip.
 */
export function restCabinN(g: GameState, d: Duty): number {
  const p = g.pairings[d.pairingId];
  if (p && pilotsOnlyTrip(g, p)) return 0;
  const ac = p?.aircraftId ? g.fleet[p.aircraftId] : undefined;
  const c = p?.contractId ? g.contracts[p.contractId] : undefined;
  return Math.max(cabinMinimum(ac?.cabin.total ?? 180), 1) + (c?.requirements.extraCabin ?? 0);
}

const typeEarly = (typeId: string) => {
  const t = ACMI_TYPES[typeId];
  return t ? BAL.v072.ftl.cabinEarlyMin[t.body] : 0;
};

const memo = new WeakMap<Duty, { key: string; plan: RestPlan }>();

/**
 * v0.7.3 the rest plan of a duty (its augmentation, or `opts.augment` to try one), names filled from its pairing's
 * slots; null when the duty is unaugmented and no augmentation is asked for. Pure (memoised per duty).
 */
export function restPlan(g: GameState, dutyId: string, opts: { augment?: 1 | 2 } = {}): RestPlan | null {
  const d = g.duties[dutyId];
  if (!d) return null;
  const augment = opts.augment ?? (d.augment > 0 ? (d.augment as 1 | 2) : null);
  if (!augment) return null;
  const p = g.pairings[d.pairingId];
  const ac = p?.aircraftId ? g.fleet[p.aircraftId] : undefined;
  const rest = restOf(g, p?.aircraftId ?? null);
  const early = d.cabinEarly ?? typeEarly(ac?.typeId ?? 'a320ceo');
  const legs = restLegs(g, d);
  const n = restCabinN(g, d);
  const key = `${augment}:${d.legacyRest ? 'L' : ''}${d.basicFdp ?? ''}:${d.fdp}:${early}:${n}:${JSON.stringify(rest)}:${legs.map((l) => `${l.id}@${l.std}-${l.sta}`).join()}:${p ? p.slots.map((s) => s.crewId ?? '-').join() : ''}`;
  // A day that has shrunk under the no-rest limit (a leg cancelled or split off under way) needs no in-flight rest.
  const moot = (x: RestPlan) => (!x.ok && !opts.augment && d.basicFdp !== undefined && d.fdp <= d.basicFdp ? null : x);
  const hit = memo.get(d);
  if (hit && hit.key === key) return moot(hit.plan);
  if (!legs.length) return null;
  const plan = planRest(legs, rest, augment, d.fdp + early, n);
  if (d.legacyRest) plan.legacy = true;
  if (p) nameTurns(g, plan, p.slots);
  memo.set(d, { key, plan });
  return moot(plan);
}

/** Fills crewIds: pilots by seat (the second CPT/FO are CPT2/FO2), cabin crew in slot order by group. */
function nameTurns(g: GameState, plan: RestPlan, slots: { role: string; crewId: string | null }[]): void {
  const bySeat: Partial<Record<RestSeat, string>> = {};
  const seen: Record<string, number> = {};
  const cabin: string[] = [];
  for (const s of slots) {
    if (!s.crewId || !g.crew[s.crewId]) continue;
    if (s.role === 'PUR' || s.role === 'CC') {
      cabin.push(s.crewId);
      continue;
    }
    const k = (seen[s.role] = (seen[s.role] ?? 0) + 1);
    const seat = (k > 1 ? `${s.role}2` : s.role) as RestSeat;
    bySeat[seat] ??= s.crewId;
  }
  for (const t of plan.pilots) t.crewIds = t.seat && bySeat[t.seat] ? [bySeat[t.seat]!] : [];
  let i = 0;
  const groups = [...new Set(plan.cabin.map((t) => t.group ?? 0))].sort((a, b) => a - b);
  for (const k of groups) {
    const t = plan.cabin.find((x) => x.group === k)!;
    t.crewIds = cabin.slice(i, i + t.n);
    i += t.n;
  }
}

/**
 * v0.7.3 a duty the roster had to split with a fresh crew because the cruise was too short for in-flight rest: the
 * next duty on the aircraft starts where this one ends within 3 h, the two together are over the no-rest limit
 * (Table 2 at the joint report and sectors, and a planned extension), would fit the augmented limit with the
 * aircraft's facilities, but the rest plan is 'tooShort'. The failed plan, the next duty and the joint day's no-rest
 * limit (`basic`), else null. Pure.
 */
export function slipShort(g: GameState, dutyId: string): { plan: RestPlan; next: Duty; fdp: number; max: number; basic: number } | null {
  const d = g.duties[dutyId];
  if (!d || d.augment > 0 || d.done) return null;
  const p = g.pairings[d.pairingId];
  const ac = p?.aircraftId ? g.fleet[p.aircraftId] : undefined;
  if (!ac || !g.company.approvals.includes('augmented')) return null;
  const rest = restOf(g, ac.id);
  if (!rest.fc || !rest.cc) return null;
  const last = g.flights[d.flightIds[d.flightIds.length - 1]];
  if (!last) return null;
  let next: Duty | null = null;
  for (const q of crewIx(g).byAircraft.get(ac.id) ?? []) {
    if (q.end < last.sta || q.start > last.sta + 6 * H) continue;
    for (const id of q.dutyIds) {
      const x = g.duties[id];
      const f0 = x ? g.flights[x.flightIds[0]] : undefined;
      if (!x || x.id === d.id || x.done || !f0 || f0.from !== last.to || f0.std < last.sta || f0.std > last.sta + 3 * H) continue;
      if (!next || f0.std < g.flights[next.flightIds[0]].std) next = x;
    }
  }
  if (!next) return null;
  const legs = [...restLegs(g, d), ...restLegs(g, next)];
  if (legs.length > 3) return null;
  const fdp = legs[legs.length - 1].sta - d.report;
  // Split only when the rest rule forced it: one crew without rest (basic or a planned extension) could not fly both.
  const both = [...d.flightIds, ...next.flightIds].map((id) => g.flights[id]).filter((f): f is Flight => !!f && f.status !== 'cancelled');
  const solo = dutyNeed(g, ac.typeId, NONE, { from: both[0].from, std: both[0].std, legs: both.map((f) => ({ std: f.std, sta: f.sta, from: f.from, to: f.to })) });
  if (solo.mode === 'basic' || solo.mode === 'ext') return null;
  const early = typeEarly(ac.typeId);
  let longest = 0;
  for (const l of legs) longest = Math.max(longest, l.sta - l.std);
  for (const a of [1, 2] as const) {
    const lim = augLimitOf(rest.fc.cls, rest.cc.cls, a, legs.length <= 2 && longest - 20 > 9 * H, early);
    if (fdp > lim.max) continue;
    const plan = planRest(legs, rest, a, fdp + lim.early, restCabinN(g, d));
    if (plan.code === 'tooShort') {
      nameTurns(g, plan, p.slots);
      return { plan, next, fdp, max: lim.max, basic: solo.max };
    }
    return null;
  }
  return null;
}

/**
 * v0.7.3 the rest plan of the duty a flight belongs to; for a duty split with a fresh crew because the cruise was
 * too short (slipShort), the failed plan ('Not possible', with its why). Pure.
 */
export function restPlanForFlight(g: GameState, flightId: string): RestPlan | null {
  const f = g.flights[flightId];
  if (!f?.dutyId) return null;
  return restPlan(g, f.dutyId) ?? slipShort(g, f.dutyId)?.plan ?? null;
}

/** v0.7.3 crew resting on an aircraft at t (map panel): names, where and until when. Pure. */
export function restNow(g: GameState, aircraftId: string, t: Minute): { names: string[]; where: RestKind; until: Minute }[] {
  const ac = g.fleet[aircraftId];
  const f = ac?.flightId ? g.flights[ac.flightId] : undefined;
  if (!f) return [];
  const plan = restPlanForFlight(g, f.id);
  if (!plan?.ok) return [];
  const out: { names: string[]; where: RestKind; until: Minute }[] = [];
  for (const x of [...plan.pilots, ...plan.cabin]) {
    if (x.flightId !== f.id || x.start > t || x.end <= t) continue;
    const names = x.crewIds.map((id) => g.crew[id]).filter((c) => !!c).map((c) => (x.seat ? `${x.seat === 'CPT' || x.seat === 'CPT2' ? 'Capt.' : x.seat === 'CRP' ? 'CRP' : 'FO'} ${c!.last}` : `${c!.first} ${c!.last}`));
    out.push({ names: names.length ? names : [x.seat ?? `Group ${String.fromCharCode(65 + (x.group ?? 0))} (${x.n})`], where: x.where, until: x.end });
  }
  return out;
}

/** v0.7.3 the verdict chip: 'Rest plan OK' / 'Tight: 10 min spare' / 'Not possible'. Pure. */
export function restVerdict(p: RestPlan | null): { tone: 'good' | 'warn' | 'bad'; text: string } | null {
  if (!p) return null;
  if (!p.ok) return p.legacy ? { tone: 'warn', text: 'Planned before the new rules' } : { tone: 'bad', text: 'Not possible' };
  if (p.spareMin < BAL.v073.rest.tightSpare) return { tone: 'warn', text: `Tight: ${p.spareMin} min spare` };
  return { tone: 'good', text: 'Rest plan OK' };
}

// ---------- longest day ----------

export interface LongestDay {
  /** 13:00 (best Table 2 cell). */
  basic: number;
  /** 14:00 as a planned extension. */
  ext: number | null;
  /** Incl. the cabin crew cap and early-report drop (C2). */
  aug1: number | null;
  aug2: number | null;
  /** With the one-long-sector bonus. */
  aug1Long: number | null;
  aug2Long: number | null;
  /** What limits the longest augmented day. */
  capBy: 'pilots' | 'cabin' | null;
  /** v0.7.4 'Longest day: 13 h · up to 17 h'. */
  text: string;
  /** v0.7.4 the details for the tooltip: the extension, who rests where, the approval. */
  detail: string;
}

const hrs = (m: number) => (m % 60 ? hm(m) : `${m / 60} h`);

/** v0.7.3 the longest day an airframe with these facilities allows (UPDATE-0.7.3.md §2.4 texts). Pure. */
export function longestDay(g: GameState, rest: AcRest, typeId: string): LongestDay {
  const basic = 13 * H;
  const ext = 14 * H;
  const early = typeEarly(typeId);
  const approved = g.company.approvals.includes('augmented');
  const a1 = augLimit(rest, 1, false, early);
  const a2 = augLimit(rest, 2, false, early);
  const a1L = augLimit(rest, 1, true, early);
  const a2L = augLimit(rest, 2, true, early);
  const out: LongestDay = { basic, ext, aug1: a1?.max ?? null, aug2: a2?.max ?? null, aug1Long: a1L?.max ?? null, aug2Long: a2L?.max ?? null, capBy: a2L?.capBy ?? null, text: '', detail: '' };
  // v0.7.4 the card line is just '13 h · up to 17 h': the plain 2-pilot limit, then the most this aircraft's own rest
  // allows with the best augmented crew (the one-long-sector bonus only where the type can fly a 9 h+ sector). The
  // extension, the approval and who limits it go into `detail` (the tooltip).
  const t = ACMI_TYPES[typeId];
  const canLong = !!t && t.rangeNm / t.cruiseKt > 9.3;
  const best = Math.max(0, ...[a1, a2, canLong ? a1L : null, canLong ? a2L : null].map((x) => x?.max ?? 0));
  const bestCap = (canLong ? a2L : a2)?.capBy ?? null;
  out.text = best > basic ? `Longest day: ${hrs(basic)} · up to ${hrs(best)}` : `Longest day: ${hrs(basic)}`;
  // v0.9 (UPDATE-0.9.md §U.2): 'up to' is extra pilots resting on board, never captain's discretion.
  const parts = [`${hrs(basic)} with 2 pilots (${hrs(ext)} as a planned extension, twice a week per crew).`];
  if (best > basic && rest.fc && rest.cc) {
    const capWord = restWords(rest.cc.kind);
    parts.push(`Up to ${hrs(best)} with ${a1 && best <= a1.max ? 3 : 4} pilots who take turns to rest on board (pilots in ${restWords(rest.fc.kind)}, cabin crew in ${capWord})${bestCap === 'cabin' ? `; the cabin crew's ${capWord} allow ${hrs(cabinFdpCap(rest.cc.cls))}` : ''}.`);
    if (!approved) parts.push(`Days over ${hrs(basic)} need the Augmented crew approval.`);
  } else if (!rest.fc || !rest.cc) parts.push(`No in-flight rest for the ${!rest.fc && !rest.cc ? 'crew' : rest.fc ? 'cabin crew' : 'pilots'}.`);
  parts.push("Captain's discretion is never part of this: it is only for surprises on the day, after the crew has reported.");
  out.detail = parts.join(' ');
  return out;
}

/** 'Longest day 15:40 · …' helper: minutes as h:mm. */
export const restHm = hm;
export const restDuration = (m: number) => fmtDuration(m);
