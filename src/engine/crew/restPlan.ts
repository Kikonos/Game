// v0.7.3 in-flight rest (UPDATE-0.7.3.md §2.1–§2.5; CS FTL.1.205(c)): the pilots' and cabin crew's facilities per
// airframe (migrated from the v0.7.2 {bunks, seats}), the deterministic rest plan of a duty (who rests when, where
// and for how long), the "longest day" an airframe allows and the plain-language rest lines. Pure.

import { ACMI_TYPES } from '../../data/acmiTypes';
import { BAL } from '../core/balance';
import { cabinMinimum, typeOf } from '../core/perf';
import { fmtDuration } from '../core/time';
import type { AcRest, Aircraft, AircraftOffer, Duty, Flight, GameState, Minute, RestFacility, RestKind } from '../core/types';
import { hashUnit } from '../core/util';
import { augLimitOf, cabinFdpCap, cabinInflightRest } from './rules';

const H = 60;
const NONE: AcRest = { fc: null, cc: null };

// ---------- facilities ----------

const fcrc = (): RestFacility => ({ cls: 1, kind: 'fcrc', places: 2 });
const ccrcOf = (typeId: string): RestFacility | null => {
  const t = ACMI_TYPES[typeId];
  if (!t || !t.rest.ccrcPlaces) return null;
  return { cls: 1, kind: t.rest.ccrcKind, places: t.rest.ccrcPlaces };
};
/** Curtained business seats for one side (pilots 2; cabin crew min(J − 2, ⌈typical / 2⌉)); null without J ≥ 4. */
export function jSeatsFor(typeId: string, j: number, side: 'fc' | 'cc'): RestFacility | null {
  const t = ACMI_TYPES[typeId];
  if (!t || j < 4) return null;
  const places = side === 'fc' ? 2 : Math.max(1, Math.min(j - 2, Math.ceil(t.cabinTypical / 2)));
  return { cls: t.rest.jClass, kind: 'jSeats', places };
}

/**
 * v0.7.3 the v0.7.2 crew rest of an airframe or offer in the new model (UPDATE-0.7.3.md §2.1 migration table):
 * bunks → the type's compartments; rest seats → grandfathered class 3 recliners; nothing on a two-class cabin →
 * curtained business seats (class 2); nothing recorded (older saves, start fleet) → bunks on a widebody whose type
 * had a rest class. Idempotent (returns `rest` when already set). Pure.
 */
export function migrateRest(x: Pick<Aircraft, 'typeId' | 'cabin' | 'crewRest' | 'rest'> | Pick<AircraftOffer, 'typeId' | 'cabin' | 'crewRest' | 'rest'>): AcRest {
  if (x.rest) return x.rest;
  const t = ACMI_TYPES[x.typeId];
  if (!t) return { ...NONE };
  const old = x.crewRest ?? { bunks: t.body === 'wide' && t.restClass !== null, seats: 0 };
  if (old.bunks) return { fc: fcrc(), cc: ccrcOf(x.typeId) ?? jSeatsFor(x.typeId, x.cabin.j, 'cc') };
  if (old.seats > 0) return { fc: { cls: 3, kind: 'recliners', places: Math.min(2, old.seats) }, cc: { cls: 3, kind: 'recliners', places: Math.max(1, old.seats - 2) } };
  if (t.body === 'wide' && x.cabin.j >= 4) return { fc: jSeatsFor(x.typeId, x.cabin.j, 'fc'), cc: jSeatsFor(x.typeId, x.cabin.j, 'cc') };
  return { ...NONE };
}

/**
 * v0.7.3 market roll of an airframe's facilities (`u()` gives uniform numbers in [0, 1)): a pilots' compartment and a
 * cabin crew compartment (independent), then curtained business seats for a side still empty. Pure.
 */
export function rollRest(typeId: string, j: number, u: () => number): AcRest {
  const t = ACMI_TYPES[typeId];
  if (!t || t.body !== 'wide') return { ...NONE };
  const R = t.rest;
  const a = u();
  const b = u();
  const c = u();
  const fc = R.fcrcShare >= 1 || (R.fcrcShare > 0 && a < R.fcrcShare) ? fcrc() : null;
  const cc = R.ccrcShare >= 1 || (R.ccrcShare > 0 && b < R.ccrcShare) ? ccrcOf(typeId) : null;
  const curtain = R.jCurtainShare > 0 && c < R.jCurtainShare;
  return { fc: fc ?? (curtain ? jSeatsFor(typeId, j, 'fc') : null), cc: cc ?? (curtain ? jSeatsFor(typeId, j, 'cc') : null) };
}

/** v0.7.3 the start fleet / dev fleet roll: deterministic from the aircraft id (widebodies only). Pure. */
export function rollRestFor(id: string, typeId: string, j: number): AcRest {
  let k = 0;
  return rollRest(typeId, j, () => hashUnit(`${id}:rest:${k++}`));
}

/**
 * v0.7.3 load: facilities for every airframe and open offer (`??= migrateRest`). When an airframe had none (a
 * pre-v0.7.3 save), duties already crewed and reporting within 72 h keep their augmentation without the rest-plan
 * check (`legacyRest`), so nothing an old save relies on turns illegal on load.
 */
export function loadRest(g: GameState): void {
  let migrated = false;
  for (const ac of Object.values(g.fleet)) {
    if (ac.rest) continue;
    ac.rest = migrateRest(ac);
    migrated = true;
  }
  for (const o of g.market?.aircraft ?? []) o.rest ??= migrateRest(o);
  if (!migrated) return;
  for (const d of Object.values(g.duties)) {
    if (d.done || d.report > g.now + 72 * H) continue;
    const p = g.pairings[d.pairingId];
    if (p && p.slots.some((s) => s.crewId)) d.legacyRest = true;
  }
}

/** v0.7.3 an airframe's facilities (migrated on the fly when an old record has none); {null, null} when unknown. Pure. */
export function restOf(g: GameState, aircraftId: string | null): AcRest {
  const ac = aircraftId ? g.fleet[aircraftId] : undefined;
  if (!ac) return NONE;
  return ac.rest ?? migrateRest(ac);
}

const KIND_TEXT: Record<RestKind, [string, string]> = {
  fcrc: ['bunks by the cockpit', 'bunk'],
  ccrc: ['overhead bunks', 'bunk'],
  ldmcr: ['lower-deck crew rest module', 'bunk'],
  jSeats: ['business seats, curtained', 'seat'],
  recliners: ['crew rest recliners', 'seat'],
};
/** Short word for where someone rests (timeline labels): 'bunk', 'lower deck', 'business seat', 'recliner'. */
export const restWhere = (k: RestKind): string => (k === 'fcrc' || k === 'ccrc' ? 'bunk' : k === 'ldmcr' ? 'lower deck' : k === 'jSeats' ? 'business seat' : 'recliner');

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
  const w = f.kind === 'fcrc' || f.kind === 'ccrc' ? 'bunks' : f.kind === 'ldmcr' ? 'lower-deck module' : f.kind === 'jSeats' ? 'business seats' : 'recliners';
  return `${w} (class ${f.cls})`;
}

export const isSeatRest = (f: RestFacility | null): boolean => !!f && (f.kind === 'jSeats' || f.kind === 'recliners');
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
  if (!rest.fc) return fail('noFacility', 'There is no in-flight rest for the pilots');
  if (!rest.cc) return fail('noFacility', 'There is no in-flight rest for the cabin crew');
  if (legs.length > 3) return fail('sectors', `In-flight rest allows at most 3 sectors; this day has ${legs.length}`);
  // Pilots.
  const pw = legs.map((l) => ({ a: l.std + B.tocMin, b: l.sta - B.todMin - B.wakeMin }));
  const pg = pilotGroups(rest.fc, augment);
  const pat = placeBackwards(pg, pw);
  const miss = pat.findIndex((x) => x < 0);
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
  // Cabin crew.
  const need = cabinInflightRest(cabinFdp, rest.cc.cls);
  if (need === null) {
    return { ...fail('cabinClass', `Class ${rest.cc.cls} ${rest.cc.kind === 'recliners' ? 'recliners allow' : rest.cc.kind === 'jSeats' ? 'business seats allow' : 'rest allows'} at most a ${hm(cabinFdpCap(rest.cc.cls))} cabin crew day; this one is ${hm(cabinFdp)}`), pilots };
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
    const where = rest.cc.kind === 'jSeats' ? 'business seats' : rest.cc.kind === 'recliners' ? 'recliners' : 'bunks';
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

const legOf = (f: Flight): RestLeg => ({ id: f.id, std: f.status === 'done' || f.status === 'enroute' ? f.atd ?? f.std : f.std, sta: f.status === 'done' ? f.ata ?? f.sta : f.status === 'enroute' ? f.eta ?? f.sta : f.sta });

/** Operated legs of a duty for the rest plan (cancelled legs and tickets left out). */
export function restLegs(g: GameState, d: Duty): RestLeg[] {
  const out: RestLeg[] = [];
  for (const id of d.flightIds) {
    const f = g.flights[id];
    if (f && f.status !== 'cancelled') out.push(legOf(f));
  }
  return out;
}

/** Cabin crew a duty's rest plan is made for: the legal minimum plus the client's required extra (optional extras ride along). */
export function restCabinN(g: GameState, d: Duty): number {
  const p = g.pairings[d.pairingId];
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
  const key = `${augment}:${d.fdp}:${early}:${n}:${JSON.stringify(rest)}:${legs.map((l) => `${l.id}@${l.std}-${l.sta}`).join()}:${p ? p.slots.map((s) => s.crewId ?? '-').join() : ''}`;
  const hit = memo.get(d);
  if (hit && hit.key === key) return hit.plan;
  const plan = legs.length ? planRest(legs, rest, augment, d.fdp + early, n) : { ...planRest([], rest, augment, d.fdp + early, n) };
  if (p) nameTurns(g, plan, p.slots);
  memo.set(d, { key, plan });
  return plan;
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
 * next duty on the aircraft starts where this one ends within 3 h, the two together would fit the augmented limit
 * with the aircraft's facilities, but the rest plan is 'tooShort'. The failed plan and the next duty, else null. Pure.
 */
export function slipShort(g: GameState, dutyId: string): { plan: RestPlan; next: Duty; fdp: number; max: number } | null {
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
  for (const x of Object.values(g.duties)) {
    const f0 = g.flights[x.flightIds[0]];
    if (x.id === d.id || x.done || !f0 || f0.aircraftId !== ac.id || f0.from !== last.to || f0.std < last.sta || f0.std > last.sta + 3 * H) continue;
    if (!next || f0.std < g.flights[next.flightIds[0]].std) next = x;
  }
  if (!next) return null;
  const legs = [...restLegs(g, d), ...restLegs(g, next)];
  if (legs.length > 3) return null;
  const fdp = legs[legs.length - 1].sta - d.report;
  const early = typeEarly(ac.typeId);
  let longest = 0;
  for (const l of legs) longest = Math.max(longest, l.sta - l.std);
  for (const a of [1, 2] as const) {
    const lim = augLimitOf(rest.fc.cls, rest.cc.cls, a, legs.length <= 2 && longest - 20 > 9 * H, early);
    if (fdp > lim.max) continue;
    const plan = planRest(legs, rest, a, fdp + lim.early, restCabinN(g, d));
    if (plan.code === 'tooShort') {
      nameTurns(g, plan, p.slots);
      return { plan, next, fdp, max: lim.max };
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
  if (!p.ok) return { tone: 'bad', text: 'Not possible' };
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
  text: string;
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
  const out: LongestDay = { basic, ext, aug1: a1?.max ?? null, aug2: a2?.max ?? null, aug1Long: a1L?.max ?? null, aug2Long: a2L?.max ?? null, capBy: a2L?.capBy ?? null, text: '' };
  const head = `Longest day: ${hrs(basic)} (${hrs(ext)} as a planned extension)`;
  if (!rest.fc && !rest.cc) {
    out.text = typeOf(typeId).body === 'wide' ? `${head} · no in-flight rest` : head;
    return out;
  }
  if (!rest.fc || !rest.cc) {
    out.text = `${head} · no in-flight rest for the ${rest.fc ? 'cabin crew' : 'pilots'}`;
    return out;
  }
  if (!approved) {
    out.text = `${head} · needs the Augmented crew approval`;
    return out;
  }
  const x1 = a1!.max;
  const x2 = a2!.max;
  const x2L = a2L!.max;
  const capWord = rest.cc.kind === 'recliners' ? 'recliners' : rest.cc.kind === 'jSeats' ? 'business seats' : 'bunks';
  const capNote = a2L!.capBy === 'cabin' ? ` (the cabin crew's ${capWord} allow ${hrs(cabinFdpCap(rest.cc.cls))})` : '';
  if (x2L <= x1) out.text = `Longest day: ${hrs(x1)} with 3 or 4 pilots${capNote}`;
  else {
    let t = `Longest day: ${hrs(x1)} with 3 pilots`;
    if (x2 > x1) t += ` · ${hrs(x2)} with 4`;
    if (x2L > x2) t += ` (${hrs(x2L)} on one long sector)`;
    out.text = t + (x2L > x2 || x2 > x1 ? capNote : '');
  }
  return out;
}

/** 'Longest day 15:40 · …' helper: minutes as h:mm. */
export const restHm = hm;
export const restDuration = (m: number) => fmtDuration(m);
